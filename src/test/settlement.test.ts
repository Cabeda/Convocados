/**
 * Payment overhaul — settlement model, config, dual-write and privacy.
 * Tests the lib functions directly plus the API routes (auth mocked to owner).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const mockGetSession = vi.fn().mockResolvedValue(null);
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: false, session: null }),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
}));

import {
  syncGamePayments,
  setPaymentConfig,
  settleShare,
  bulkSettleGame,
  selfReportSent,
  getSettlementSummary,
  shareFor,
} from "~/lib/settlement.server";
import { PATCH as setConfig } from "~/pages/api/events/[id]/payments/config";
import { GET as getSummary, PUT as settle } from "~/pages/api/events/[id]/payments/settlement";
import { PUT as bulkSettle } from "~/pages/api/events/[id]/payments/settlement/bulk";
import { POST as selfReport } from "~/pages/api/events/[id]/payments/settlement/self-report";
import { GET as getCurrentGame } from "~/pages/api/events/[id]/payments/game";
import { PUT as setCost } from "~/pages/api/events/[id]/cost";

function ctx(params: Record<string, string>, body?: unknown, method = "GET") {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? method : "GET",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

async function seedEvent(opts: { players?: string[]; cost?: number; ownerId?: string } = {}) {
  const ownerId = opts.ownerId ?? "owner-settlement";
  await prisma.user.upsert({
    where: { id: ownerId },
    update: {},
    create: { id: ownerId, name: "Owner", email: `${ownerId}@test.com` },
  });
  const event = await prisma.event.create({
    data: {
      title: "Settlement Event",
      location: "Pitch",
      dateTime: new Date(Date.now() - 3600_000),
      maxPlayers: 10,
      ownerId,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime, status: "played" } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

  const names = opts.players ?? ["Ana", "Bruno", "Carla"];
  for (let i = 0; i < names.length; i++) {
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: names[i], userId: null },
    });
    await prisma.gameParticipant.create({
      data: { gameId: game.id, eventPlayerId: ep.id, order: i },
    });
  }

  if (opts.cost !== undefined) {
    await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: opts.cost, currency: "EUR" },
    });
  }

  return { event, game };
}

async function linkUser(name: string, userId: string) {
  const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { name } });
  await prisma.eventPlayer.update({ where: { id: ep.id }, data: { userId } });
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.gamePayment.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.player.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("shareFor", () => {
  it("splits total across participants (payer + no-shows count)", () => {
    expect(shareFor(60, 3)).toBe(20);
    expect(shareFor(60, 0)).toBe(0);
    expect(shareFor(10, 3)).toBe(3.33);
  });
});

describe("effectiveGameCost overrides", () => {
  it("per-game cost override wins over the EventCost template", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await prisma.game.update({ where: { id: game.id }, data: { costTotalAmount: 90, costCurrency: "USD" } });
    await syncGamePayments(game.id, event.id);
    const rows = await prisma.gamePayment.findMany({ where: { gameId: game.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.amount === 30)).toBe(true);
  });

  it("no cost → no payment rows", async () => {
    const { event, game } = await seedEvent();
    await syncGamePayments(game.id, event.id);
    expect(await prisma.gamePayment.count({ where: { gameId: game.id } })).toBe(0);
  });

  it("untracked mode → no rows even with a cost", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await setPaymentConfig(event.id, game.id, { mode: "untracked" });
    await syncGamePayments(game.id, event.id);
    expect(await prisma.gamePayment.count({ where: { gameId: game.id } })).toBe(0);
  });
});

describe("syncGamePayments", () => {
  it("creates a pending row per participant at the share", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);

    const rows = await prisma.gamePayment.findMany({ where: { gameId: game.id }, orderBy: { playerName: "asc" } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    expect(rows.every((r) => r.amount === 20)).toBe(true);
  });

  it("auto-settles the payer's own row", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerEventPlayerId: ana.id });

    const anaRow = await prisma.gamePayment.findFirstOrThrow({ where: { gameId: game.id, eventPlayerId: ana.id } });
    expect(anaRow.status).toBe("paid");
    expect(anaRow.method).toBe("payer");

    const others = await prisma.gamePayment.findMany({ where: { gameId: game.id, status: "pending" } });
    expect(others).toHaveLength(2);
  });

  it("archives rows for participants who leave", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });
    await prisma.gameParticipant.updateMany({
      where: { gameId: game.id, eventPlayerId: ana.id },
      data: { archivedAt: new Date() },
    });
    await syncGamePayments(game.id, event.id);

    const active = await prisma.gamePayment.findMany({ where: { gameId: game.id, archivedAt: null } });
    const archived = await prisma.gamePayment.findMany({ where: { gameId: game.id, archivedAt: { not: null } } });
    expect(active).toHaveLength(2);
    expect(archived).toHaveLength(1);
    expect(active.every((r) => r.amount === 30)).toBe(true); // 60 / 2 remaining
  });
});

describe("setPaymentConfig", () => {
  it("untracked clears rows and removes the payer", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerEventPlayerId: ana.id });

    await setPaymentConfig(event.id, game.id, { mode: "untracked" });
    const g = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(g.paymentMode).toBe("untracked");
    expect(g.payerEventPlayerId).toBeNull();
    expect(await prisma.gamePayment.count({ where: { gameId: game.id } })).toBe(0);
  });

  it("rejects tracked without a payer", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await expect(setPaymentConfig(event.id, game.id, { mode: "tracked" })).rejects.toThrow(/exactly one payer/);
  });

  it("accepts an external payer name", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerExternalName: "Venue Staff" });
    const g = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(g.payerExternalName).toBe("Venue Staff");
    expect(g.paymentMode).toBe("tracked");
  });

  it("reverts the old player-payer's auto-paid row when the payer changes", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });
    const bruno = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Bruno" } });

    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerEventPlayerId: ana.id });
    const anaRow = await prisma.gamePayment.findFirstOrThrow({ where: { gameId: game.id, eventPlayerId: ana.id } });
    expect(anaRow.status).toBe("paid");
    expect(anaRow.method).toBe("payer");

    // Switch payer to Bruno → Ana reverts to pending debtor.
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerEventPlayerId: bruno.id });
    const anaAfter = await prisma.gamePayment.findFirstOrThrow({ where: { gameId: game.id, eventPlayerId: ana.id } });
    const brunoAfter = await prisma.gamePayment.findFirstOrThrow({ where: { gameId: game.id, eventPlayerId: bruno.id } });
    expect(anaAfter.status).toBe("pending");
    expect(anaAfter.method).toBeNull();
    expect(brunoAfter.status).toBe("paid");
    expect(brunoAfter.method).toBe("payer");

    // Switch to an external payer → Bruno also reverts to pending.
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerExternalName: "Venue" });
    const brunoExternal = await prisma.gamePayment.findFirstOrThrow({ where: { gameId: game.id, eventPlayerId: bruno.id } });
    expect(brunoExternal.status).toBe("pending");
    expect(brunoExternal.method).toBeNull();
  });

  it("rejects a blank external payer name", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await expect(setPaymentConfig(event.id, game.id, { mode: "tracked", payerExternalName: "  " }))
      .rejects.toThrow(/exactly one payer/);
  });

  it("rejects a payer from a different event", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    const other = await prisma.event.create({ data: { title: "Other", location: "X", dateTime: new Date() } });
    const otherPlayer = await prisma.eventPlayer.create({ data: { eventId: other.id, name: "Z" } });
    await expect(setPaymentConfig(event.id, game.id, { mode: "tracked", payerEventPlayerId: otherPlayer.id }))
      .rejects.toThrow(/not a participant/);
  });
});

describe("settleShare + ledger dual-write", () => {
  it("marks paid and writes a payment_received ledger credit at the share", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });

    await settleShare(event.id, game.id, ana.id, "owner-settlement");

    const row = await prisma.gamePayment.findUniqueOrThrow({ where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: ana.id } } });
    expect(row.status).toBe("paid");
    expect(row.markedBy).toBe("owner-settlement");

    const tx = await prisma.walletTransaction.findFirstOrThrow({ where: { eventId: event.id, reason: "payment_received" } });
    expect(tx.amountCents).toBe(2000);
    expect(tx.statusAfter).toBe("paid");
  });
});

describe("bulkSettleGame", () => {
  it("settles every debtor share", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerEventPlayerId: ana.id });

    const updated = await bulkSettleGame(event.id, game.id, "owner-settlement");
    expect(updated).toBe(2);
    const pending = await prisma.gamePayment.count({ where: { gameId: game.id, status: { not: "paid" } } });
    expect(pending).toBe(0);
  });
});

describe("selfReportSent", () => {
  it("moves pending → sent", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });
    await selfReportSent(game.id, ana.id);
    const row = await prisma.gamePayment.findUniqueOrThrow({ where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: ana.id } } });
    expect(row.status).toBe("sent");
  });
});

describe("getSettlementSummary (privacy)", () => {
  it("manager sees debtor names and all people", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerEventPlayerId: ana.id });

    const s = await getSettlementSummary(event.id, { role: "owner", userId: "owner-settlement" });
    expect(s.games).toHaveLength(1);
    expect(s.games[0].debtorNames.sort()).toEqual(["Bruno", "Carla"]);
    expect(s.games[0].payerName).toBe("Ana");
    expect(s.totals.totalOwedTo).toBe(40);
    expect(s.people.some((p) => p.name === "Ana" && p.isPayer)).toBe(true);
  });

  it("player sees receivers + own debt only, no other debtor names", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerEventPlayerId: ana.id });
    await linkUser("Bruno", "user-bruno");

    const s = await getSettlementSummary(event.id, { role: "player", userId: "user-bruno" });
    expect(s.games[0].debtorNames).toEqual([]);
    const brunoPerson = s.people.find((p) => p.name === "Bruno");
    expect(brunoPerson?.owedAmount).toBe(20);
    expect(brunoPerson?.isPayer).toBe(false);
    const anaPerson = s.people.find((p) => p.name === "Ana");
    expect(anaPerson?.isPayer).toBe(true);
    // Carla (another debtor) must not appear for Bruno.
    expect(s.people.some((p) => p.name === "Carla")).toBe(false);
  });

  it("settled games drop off the page", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerEventPlayerId: ana.id });
    await bulkSettleGame(event.id, game.id, "owner-settlement");

    const s = await getSettlementSummary(event.id, { role: "owner", userId: "owner-settlement" });
    expect(s.games).toHaveLength(0);
    expect(s.totals.unsettledGames).toBe(0);
  });

  it("untracked games are excluded from the summary", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await setPaymentConfig(event.id, game.id, { mode: "untracked" });
    const s = await getSettlementSummary(event.id, { role: "owner", userId: "owner-settlement" });
    expect(s.games).toHaveLength(0);
    expect(s.people).toHaveLength(0);
  });

  it("external payer appears as a receiver", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerExternalName: "Venue" });
    const s = await getSettlementSummary(event.id, { role: "owner", userId: "owner-settlement" });
    const venue = s.people.find((p) => p.name === "Venue");
    expect(venue?.isPayer).toBe(true);
    expect(venue?.isPlayer).toBe(false);
    expect(venue?.owedToAmount).toBe(60);
  });
});

describe("error paths", () => {
  it("settleShare rejects an unknown payment", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await expect(settleShare(event.id, game.id, "missing-id", "owner-settlement"))
      .rejects.toThrow(/Payment not found/);
  });

  it("selfReportSent rejects when not pending", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });
    await settleShare(event.id, game.id, ana.id, "owner-settlement");
    await expect(selfReportSent(game.id, ana.id)).rejects.toThrow(/when status is pending/);
  });
});

describe("settlement API routes", () => {
  it("GET requires authentication", async () => {
    const { event } = await seedEvent();
    const res = await getSummary(ctx({ id: event.id }));
    expect(res.status).toBe(401);
  });

  it("PATCH config rejects tracked without a payer", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    mockGetSession.mockResolvedValue({ user: { id: "owner-settlement", name: "Owner" } });
    const res = await setConfig(ctx({ id: event.id }, { gameId: game.id, mode: "tracked" }, "PATCH"));
    expect(res.status).toBe(400);
  });

  it("PATCH config sets an external payer and GET reflects it", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    mockGetSession.mockResolvedValue({ user: { id: "owner-settlement", name: "Owner" } });

    const res = await setConfig(
      ctx({ id: event.id }, { gameId: game.id, mode: "tracked", payerExternalName: "Venue" }, "PATCH"),
    );
    expect(res.status).toBe(200);

    const summary = await getSummary(ctx({ id: event.id }));
    const json = await summary.json();
    expect(json.games[0].payerName).toBe("Venue");
    expect(json.games[0].payerIsPlayer).toBe(false);
  });

  it("PUT settle marks a share paid", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    mockGetSession.mockResolvedValue({ user: { id: "owner-settlement", name: "Owner" } });
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });

    const res = await settle(ctx({ id: event.id }, { gameId: game.id, eventPlayerId: ana.id }, "PUT"));
    expect(res.status).toBe(200);
    const row = await prisma.gamePayment.findUniqueOrThrow({ where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: ana.id } } });
    expect(row.status).toBe("paid");
  });

  it("POST self-report only works on own share", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    mockGetSession.mockResolvedValue({ user: { id: "user-bruno", name: "Bruno" } });
    await linkUser("Bruno", "user-bruno");
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Ana" } });

    const forbidden = await selfReport(ctx({ id: event.id }, { gameId: game.id, eventPlayerId: ana.id }, "POST"));
    expect(forbidden.status).toBe(403);

    const bruno = await prisma.eventPlayer.findFirstOrThrow({ where: { name: "Bruno" } });
    const ok = await selfReport(ctx({ id: event.id }, { gameId: game.id, eventPlayerId: bruno.id }, "POST"));
    expect(ok.status).toBe(200);
  });

  it("bulk settle route settles a game", async () => {
    const { event, game } = await seedEvent({ cost: 60 });
    await syncGamePayments(game.id, event.id);
    mockGetSession.mockResolvedValue({ user: { id: "owner-settlement", name: "Owner" } });

    const res = await bulkSettle(ctx({ id: event.id }, { gameId: game.id }, "PUT"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(3);
  });

  it("config route rejects a game from another event", async () => {
    const { event } = await seedEvent({ cost: 60 });
    const other = await prisma.event.create({ data: { title: "Other", location: "X", dateTime: new Date() } });
    const otherGame = await prisma.game.create({ data: { eventId: other.id, dateTime: new Date() } });
    mockGetSession.mockResolvedValue({ user: { id: "owner-settlement", name: "Owner" } });

    const res = await setConfig(
      ctx({ id: event.id }, { gameId: otherGame.id, mode: "tracked", payerExternalName: "X" }, "PATCH"),
    );
    expect(res.status).toBe(400);
  });

  it("config route rejects when no active game", async () => {
    const { event } = await seedEvent({ cost: 60 });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: null } });
    mockGetSession.mockResolvedValue({ user: { id: "owner-settlement", name: "Owner" } });
    const res = await setConfig(ctx({ id: event.id }, { mode: "tracked", payerExternalName: "X" }, "PATCH"));
    expect(res.status).toBe(400);
  });

  it("settle route rejects missing ids", async () => {
    const { event } = await seedEvent({ cost: 60 });
    mockGetSession.mockResolvedValue({ user: { id: "owner-settlement", name: "Owner" } });
    const res = await settle(ctx({ id: event.id }, { gameId: "", eventPlayerId: "" }, "PUT"));
    expect(res.status).toBe(400);
  });

  it("settlement GET returns 404 for a missing event", async () => {
    const res = await getSummary(ctx({ id: "does-not-exist" }));
    expect(res.status).toBe(404);
  });

  it("setting a cost creates payment rows for existing participants", async () => {
    const { event } = await seedEvent({ players: ["Ana", "Bruno"] }); // no cost yet
    mockGetSession.mockResolvedValue({ user: { id: "owner-settlement", name: "Owner" } });

    const res = await setCost(ctx({ id: event.id }, { totalAmount: 60, currency: "EUR" }, "PUT"));
    expect(res.status).toBe(200);

    const game = await prisma.game.findFirstOrThrow({ where: { eventId: event.id } });
    const rows = await prisma.gamePayment.findMany({ where: { gameId: game.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.amount === 30)).toBe(true);
  });

  it("current-game settlement derives rows from participants (picker never empty)", async () => {
    const { event } = await seedEvent({ players: ["Ana", "Bruno"] }); // no cost, no payment rows
    mockGetSession.mockResolvedValue({ user: { id: "owner-settlement", name: "Owner" } });

    const res = await getCurrentGame(ctx({ id: event.id }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasCost).toBe(false);
    expect(json.rows.map((r: { name: string }) => r.name)).toEqual(["Ana", "Bruno"]);
    expect(json.rows.every((r: { status: string }) => r.status === "pending")).toBe(true);
  });
});
