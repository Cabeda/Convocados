import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

import { getSession, checkOwnership } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);
const mockCheckOwnership = vi.mocked(checkOwnership);

import { getOutstandingBalance, getGateBalance, getEventBalanceSummary } from "~/lib/balance.server";
import { isSettledGameParticipant } from "~/lib/participants.server";
import { computePostGameStatus } from "~/lib/postgame.server";
import { GET as GET_HISTORY_LIST } from "~/pages/api/events/[id]/history/index";
import { DELETE as DELETE_PURGE } from "~/pages/api/events/[id]/purge-player";
import { PUT as PUT_PAYMENTS } from "~/pages/api/events/[id]/payments";

const OWNER = { id: "owner-1", name: "Owner", email: "owner@t.com" };

function ctx(params: Record<string, string>, body?: unknown, method = "DELETE") {
  const request = new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      title: "Reader Retarget",
      location: "Pitch",
      dateTime: new Date(Date.now() - 7200_000),
      durationMinutes: 60,
      sport: "Soccer",
      maxPlayers: 10,
      teamOneName: "Reds",
      teamTwoName: "Blues",
      ownerId: OWNER.id,
      ...overrides,
    },
  });
}

async function seedGame(eventId: string, overrides: Record<string, unknown> = {}) {
  return prisma.game.create({
    data: {
      eventId,
      dateTime: new Date(Date.now() - 7200_000),
      status: "played",
      teamOneName: "Reds",
      teamTwoName: "Blues",
      ...overrides,
    },
  });
}

async function seedHistory(eventId: string, overrides: Record<string, unknown> = {}) {
  return prisma.gameHistory.create({
    data: {
      eventId,
      dateTime: new Date(Date.now() - 7200_000),
      status: "played",
      teamOneName: "Reds",
      teamTwoName: "Blues",
      teamsSnapshot: JSON.stringify([
        { team: "Reds", players: [{ name: "Alice", order: 0 }] },
        { team: "Blues", players: [{ name: "Bob", order: 0 }] },
      ]),
      ...overrides,
    },
  });
}

async function seedEP(eventId: string, name: string) {
  return prisma.eventPlayer.upsert({
    where: { eventId_name: { eventId, name } },
    create: { eventId, name },
    update: {},
  });
}

async function seedGP(gameId: string, eventId: string, name: string, amount: number, status: string) {
  const ep = await seedEP(eventId, name);
  return prisma.gamePayment.upsert({
    where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
    create: { gameId, eventPlayerId: ep.id, playerName: name, amount, status },
    update: { amount, status, archivedAt: null },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: OWNER } as any);
  mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: OWNER } } as any);
  await resetApiRateLimitStore();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.mvpVote.deleteMany();
  await prisma.matchEvent.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({ data: OWNER });
});

// ── balance.server: legacy (anonymous) paths read GamePayment ───────────────

describe("balance readers retargeted to GamePayment", () => {
  it("legacy outstanding balance counts GamePayment pending, ignoring a stale all-paid snapshot", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);
    // Snapshot claims everything is paid — must be ignored.
    await seedHistory(event.id, {
      id: game.id,
      dateTime: game.dateTime,
      paymentsSnapshot: JSON.stringify([
        { playerName: "Ghost", amount: 10, status: "paid" },
      ]),
    });
    // Durable roll says Ghost still owes.
    await seedGP(game.id, event.id, "Ghost", 10, "pending");

    const bal = await getOutstandingBalance(event.id, "Ghost");
    expect(bal.amount).toBe(10);
    expect(bal.gamesOwed).toBe(1);

    const gate = await getGateBalance(event.id, "Ghost");
    expect(gate).toBe(10);
  });

  it("legacy gate balance ignores a stale pending snapshot when GamePayment says paid", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);
    await seedHistory(event.id, {
      id: game.id,
      dateTime: game.dateTime,
      paymentsSnapshot: JSON.stringify([
        { playerName: "Ghost", amount: 10, status: "pending" },
      ]),
    });
    await seedGP(game.id, event.id, "Ghost", 10, "paid");

    const gate = await getGateBalance(event.id, "Ghost");
    expect(gate).toBe(0);
  });

  it("getEventBalanceSummary debts come from GamePayment, not the poisoned snapshot", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);
    await seedHistory(event.id, {
      id: game.id,
      dateTime: game.dateTime,
      paymentsSnapshot: JSON.stringify([
        { playerName: "Alice", amount: 10, status: "paid" },
        { playerName: "Bob", amount: 10, status: "paid" },
      ]),
    });
    // Anonymous (unlinked) players → legacy branch reads GamePayment.
    await seedGP(game.id, event.id, "Alice", 10, "pending");
    await seedGP(game.id, event.id, "Bob", 10, "paid");

    const summary = await getEventBalanceSummary(event.id);
    expect(summary.balances).toHaveLength(1);
    expect(summary.balances[0].playerName).toBe("Alice");
    expect(summary.balances[0].amount).toBe(10);
  });

  it("social-proof aggregate falls back to the latest Game's GamePayment roll", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);
    await seedHistory(event.id, {
      id: game.id,
      dateTime: game.dateTime,
      paymentsSnapshot: JSON.stringify([
        { playerName: "Alice", amount: 10, status: "pending" },
        { playerName: "Bob", amount: 10, status: "pending" },
      ]),
    });
    await seedGP(game.id, event.id, "Alice", 10, "paid");
    await seedGP(game.id, event.id, "Bob", 10, "paid");

    const summary = await getEventBalanceSummary(event.id);
    expect(summary.totalCount).toBe(2);
    expect(summary.paidCount).toBe(2);
  });
});

// ── participants.server: payment names from GamePayment ─────────────────────

describe("isSettledGameParticipant payment names from GamePayment", () => {
  it("counts a payer whose name only exists on GamePayment (snapshot has no payments)", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);
    const history = await seedHistory(event.id, {
      id: game.id,
      dateTime: game.dateTime,
      teamsSnapshot: null,
      paymentsSnapshot: null,
    });
    await seedGP(game.id, event.id, "Payer Pat", 10, "paid");

    const isParticipant = await isSettledGameParticipant({
      sessionUser: { id: "pat-1", name: "Payer Pat" },
      event: { id: event.id, dateTime: event.dateTime },
      latestHistory: history,
    });
    expect(isParticipant).toBe(true);
  });

  it("ignores a name that only exists in a stale paymentsSnapshot", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);
    const history = await seedHistory(event.id, {
      id: game.id,
      dateTime: game.dateTime,
      teamsSnapshot: null,
      paymentsSnapshot: JSON.stringify([
        { playerName: "Stale Stan", amount: 10, status: "pending" },
      ]),
    });
    // Durable roll has no Stan (purged/never charged).
    await seedGP(game.id, event.id, "Other Olivia", 10, "pending");

    const isParticipant = await isSettledGameParticipant({
      sessionUser: { id: "stan-1", name: "Stale Stan" },
      event: { id: event.id, dateTime: event.dateTime },
      latestHistory: history,
    });
    expect(isParticipant).toBe(false);
  });
});

// ── postgame.server: banner payment state from GamePayment ──────────────────

describe("post-game status payment state from GamePayment", () => {
  it("allPaid and the banner payload follow GamePayment, not the poisoned snapshot", async () => {
    const event = await seedEvent({ dateTime: new Date(Date.now() - 7200_000) });
    await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 20, currency: "EUR" },
    });
    const game = await seedGame(event.id);
    await seedHistory(event.id, {
      id: game.id,
      dateTime: game.dateTime,
      paymentsSnapshot: JSON.stringify([
        { playerName: "Alice", amount: 10, status: "paid" },
        { playerName: "Bob", amount: 10, status: "paid" },
      ]),
    });
    await seedGP(game.id, event.id, "Alice", 10, "paid");
    await seedGP(game.id, event.id, "Bob", 10, "pending");

    const status = await computePostGameStatus(event.id, new Request("http://localhost/api/test"));
    expect(status).not.toBeNull();
    expect(status!.allPaid).toBe(false);
    const bob = status!.paymentsSnapshot?.find((p) => p.playerName === "Bob");
    expect(bob?.status).toBe("pending");
  });

  it("hasPendingPastPayments reads the past Game's roll after a reset", async () => {
    const pastDt = new Date(Date.now() - 7 * 86400_000);
    const event = await seedEvent({ dateTime: new Date(Date.now() + 86400_000) }); // reset forward
    const pastGame = await seedGame(event.id, { dateTime: pastDt });
    await seedHistory(event.id, {
      id: pastGame.id,
      dateTime: pastDt,
      paymentsSnapshot: JSON.stringify([{ playerName: "Alice", amount: 10, status: "paid" }]),
    });
    await seedGP(pastGame.id, event.id, "Alice", 10, "pending");

    const status = await computePostGameStatus(event.id, new Request("http://localhost/api/test"));
    expect(status).not.toBeNull();
    expect(status!.hasPendingPastPayments).toBe(true);
  });

  it("reads the live occurrence via currentGameId when Game.dateTime drifted from Event.dateTime", async () => {
    // Mirrors the E2E flow: cost is set AFTER the event was moved to the past,
    // so the Game row keeps its original (future) dateTime while Event.dateTime
    // moved back. Date-matching alone would miss the live occurrence.
    const event = await seedEvent({ dateTime: new Date(Date.now() - 7200_000) });
    await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 20, currency: "EUR" },
    });
    const driftedGame = await seedGame(event.id, { dateTime: new Date(Date.now() + 86400_000) });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: driftedGame.id } });
    await seedGP(driftedGame.id, event.id, "Alice", 20, "pending");

    const status = await computePostGameStatus(event.id, new Request("http://localhost/api/test"));
    expect(status).not.toBeNull();
    expect(status!.allPaid).toBe(false);
    expect(status!.hasCost).toBe(true);
  });
});

// ── history list GET: paymentsSnapshot served from the Game roll ────────────

describe("history list payments served from GamePayment", () => {
  it("overrides a poisoned GameHistory paymentsSnapshot with the Game's roll", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);
    await seedHistory(event.id, {
      id: game.id,
      dateTime: game.dateTime,
      paymentsSnapshot: JSON.stringify([
        { playerName: "Alice", amount: 10, status: "paid" },
      ]),
    });
    await seedGP(game.id, event.id, "Alice", 10, "pending");

    const request = new Request("http://localhost/api/test?limit=10", { method: "GET" });
    const res = await GET_HISTORY_LIST({ params: { id: event.id }, request } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    const entries = body.entries ?? body.data ?? body;
    const list = Array.isArray(entries) ? entries : body.history ?? [];
    expect(list.length).toBeGreaterThan(0);
    const payments = JSON.parse(list[0].paymentsSnapshot);
    expect(payments[0].status).toBe("pending");
  });
});
describe("purge-player scrubs GamePayment", () => {
  it("deletes GamePayment rows keyed by the purged player name", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);
    await seedGP(game.id, event.id, "Doomed Dan", 10, "pending");
    await seedGP(game.id, event.id, "Keeper Kate", 10, "pending");

    const res = await DELETE_PURGE(ctx({ id: event.id }, { name: "Doomed Dan" }));
    expect(res.status).toBe(200);

    const dan = await prisma.gamePayment.findMany({ where: { gameId: game.id, playerName: "Doomed Dan" } });
    expect(dan).toHaveLength(0);
    const kate = await prisma.gamePayment.findMany({ where: { gameId: game.id, playerName: "Keeper Kate" } });
    expect(kate).toHaveLength(1);
  });
});

// ── legacy PUT writer dual-writes the GamePayment roll ──────────────────────

describe("PUT /payments dual-writes GamePayment", () => {
  it("mirrors paid status onto the live occurrence GamePayment row", async () => {
    const event = await seedEvent();
    await prisma.eventCost.create({ data: { eventId: event.id, totalAmount: 20, currency: "EUR" } });
    const game = await seedGame(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
    const gp = await seedGP(game.id, event.id, "Alice", 10, "sent");
    await prisma.playerPayment.create({
      data: { eventCostId: (await prisma.eventCost.findUniqueOrThrow({ where: { eventId: event.id } })).id, playerName: "Alice", amount: 10, status: "sent" },
    });

    const request = new Request("http://localhost/api/test", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: "Alice", status: "paid", method: "cash" }),
    });
    const res = await PUT_PAYMENTS({ params: { id: event.id }, request } as any);
    expect(res.status).toBe(200);

    const updated = await prisma.gamePayment.findUniqueOrThrow({ where: { id: gp.id } });
    expect(updated.status).toBe("paid");
    expect(updated.method).toBe("cash");
    expect(updated.paidAt).not.toBeNull();
  });
});
