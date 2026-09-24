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

import { PATCH } from "~/pages/api/events/[id]/history/[historyId]";
import { POST as POST_HISTORY } from "~/pages/api/events/[id]/history/index";
import { PUT as PUT_TEAMS } from "~/pages/api/events/[id]/teams";
import { POST as POST_RANDOMIZE } from "~/pages/api/events/[id]/randomize";
import { POST as POST_APPROVE_ELO } from "~/pages/api/events/[id]/history/[historyId]/approve-elo";

function ctx(params: Record<string, string>, body?: unknown, method = "PATCH") {
  const request = new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

async function seedUser(name = "Owner") {
  return prisma.user.create({
    data: { id: `u-${name}-${Math.random().toString(36).slice(2, 8)}`, name, email: `${name.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@t.com`, emailVerified: true },
  });
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  const owner = await seedUser();
  return prisma.event.create({
    data: {
      title: "Dual Write",
      location: "Pitch",
      dateTime: new Date(Date.now() - 3600_000),
      durationMinutes: 90,
      sport: "Soccer",
      maxPlayers: 10,
      teamOneName: "Reds",
      teamTwoName: "Blues",
      ownerId: owner.id,
      ...overrides,
    },
  });
}

async function seedGame(eventId: string, overrides: Record<string, unknown> = {}) {
  return prisma.game.create({
    data: {
      eventId,
      dateTime: new Date(Date.now() - 3600_000),
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
      dateTime: new Date(Date.now() - 3600_000),
      status: "played",
      teamOneName: "Reds",
      teamTwoName: "Blues",
      teamsSnapshot: JSON.stringify([
        { team: "Reds", players: [{ name: "Alice", order: 0, slot: 0 }, { name: "Bob", order: 1, slot: 1 }] },
        { team: "Blues", players: [{ name: "Cara", order: 0, slot: 0 }, { name: "Dan", order: 1, slot: 1 }] },
      ]),
      ...overrides,
    },
  });
}

async function seedRoster(eventId: string, gameId: string, names: string[]) {
  const rows: string[] = [];
  for (const name of names) {
    const ep = await prisma.eventPlayer.upsert({
      where: { eventId_name: { eventId, name } },
      create: { eventId, name },
      update: {},
    });
    await prisma.gameParticipant.upsert({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
      create: { gameId, eventPlayerId: ep.id, order: rows.length, status: "active" },
      update: {},
    });
    rows.push(ep.id);
  }
  return rows;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const owner = { id: "owner-1", name: "Owner", email: "owner@t.com" };
  mockGetSession.mockResolvedValue({ user: owner } as any);
  mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: owner } } as any);
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
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ── score/status/isFriendly PATCH → Game ────────────────────────────────────

describe("history PATCH dual-write to Game", () => {
  it("mirrors scoreOne/scoreTwo to the Game row", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);

    const res = await PATCH(ctx({ id: event.id, historyId: game.id }, { scoreOne: 3, scoreTwo: 1 }));
    expect(res.status).toBe(200);

    const updated = await prisma.game.findUnique({ where: { id: game.id } });
    expect(updated!.scoreOne).toBe(3);
    expect(updated!.scoreTwo).toBe(1);
  });

  it("mirrors status=cancelled to the Game row resolved by occurrence dateTime", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id);
    const game = await seedGame(event.id, { dateTime: history.dateTime });

    const res = await PATCH(ctx({ id: event.id, historyId: history.id }, { status: "cancelled" }));
    expect(res.status).toBe(200);

    const updated = await prisma.game.findUnique({ where: { id: game.id } });
    expect(updated!.status).toBe("cancelled");
  });

  it("mirrors scoreSets to the Game row for tennis events", async () => {
    const event = await seedEvent({ sport: "Tennis" });
    const history = await seedHistory(event.id);
    const game = await seedGame(event.id, { dateTime: history.dateTime });
    const sets = [
      { teamOne: 6, teamTwo: 4 },
      { teamOne: 3, teamTwo: 6 },
      { teamOne: 7, teamTwo: 6 },
    ];

    const res = await PATCH(ctx({ id: event.id, historyId: history.id }, { scoreSets: sets }));
    expect(res.status).toBe(200);

    const updated = await prisma.game.findUnique({ where: { id: game.id } });
    expect(updated!.scoreSets).toBe(JSON.stringify(sets));
    expect(updated!.scoreOne).toBe(2);
    expect(updated!.scoreTwo).toBe(1);
  });

  it("mirrors isFriendly toggle to the Game row", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);

    const res = await PATCH(ctx({ id: event.id, historyId: game.id }, { isFriendly: true }));
    expect(res.status).toBe(200);

    const updated = await prisma.game.findUnique({ where: { id: game.id } });
    expect(updated!.isFriendly).toBe(true);
  });

  it("syncs GameParticipant team/slot and Game team names + formations from teamsSnapshot edit", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);
    await seedRoster(event.id, game.id, ["Alice", "Bob", "Cara", "Dan"]);

    const snapshot = [
      { team: "Crimson", formation: "4-4-2", players: [{ name: "Alice", order: 0, slot: 1 }, { name: "Dan", order: 1, slot: null }] },
      { team: "Azure", formation: "3-5-2", players: [{ name: "Bob", order: 0, slot: 0 }, { name: "Cara", order: 1, slot: 2 }] },
    ];

    const res = await PATCH(ctx({ id: event.id, historyId: game.id }, { teamsSnapshot: snapshot }));
    expect(res.status).toBe(200);

    const updated = await prisma.game.findUnique({ where: { id: game.id } });
    expect(updated!.teamOneName).toBe("Crimson");
    expect(updated!.teamTwoName).toBe("Azure");
    expect(updated!.teamOneFormation).toBe("4-4-2");
    expect(updated!.teamTwoFormation).toBe("3-5-2");

    const alice = await prisma.gameParticipant.findFirst({
      where: { gameId: game.id, eventPlayer: { name: "Alice" } },
    });
    expect(alice!.team).toBe("Crimson");
    expect(alice!.slot).toBe(1);

    const cara = await prisma.gameParticipant.findFirst({
      where: { gameId: game.id, eventPlayer: { name: "Cara" } },
    });
    expect(cara!.team).toBe("Azure");
    expect(cara!.slot).toBe(2);
  });

  it("mirrors paymentsSnapshot edits to GamePayment rows", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id);
    await seedRoster(event.id, game.id, ["Alice", "Bob"]);
    const history = await seedHistory(event.id, { id: game.id, dateTime: game.dateTime });

    const payments = [
      { playerName: "Alice", amount: 12.5, status: "paid", method: "cash" },
      { playerName: "Bob", amount: 12.5, status: "pending" },
    ];

    const res = await PATCH(ctx({ id: event.id, historyId: history.id }, { paymentsSnapshot: payments }));
    expect(res.status).toBe(200);

    const alicePay = await prisma.gamePayment.findFirst({
      where: { gameId: game.id, eventPlayer: { name: "Alice" } },
    });
    expect(alicePay).not.toBeNull();
    expect(alicePay!.amount).toBe(12.5);
    expect(alicePay!.status).toBe("paid");
    expect(alicePay!.method).toBe("cash");

    const bobPay = await prisma.gamePayment.findFirst({
      where: { gameId: game.id, eventPlayer: { name: "Bob" } },
    });
    expect(bobPay).not.toBeNull();
    expect(bobPay!.status).toBe("pending");
  });
});

// ── historical POST → Game + GameParticipant ────────────────────────────────

describe("historical POST dual-write to Game", () => {
  it("creates a Game (source=historical) sharing the history id", async () => {
    const event = await seedEvent();
    const teamsSnapshot = [
      { team: "Reds", formation: "4-4-2", players: [{ name: "Alice", order: 0 }, { name: "Bob", order: 1 }] },
      { team: "Blues", formation: "4-4-2", players: [{ name: "Cara", order: 0 }, { name: "Dan", order: 1 }] },
    ];

    const res = await POST_HISTORY(
      ctx(
        { id: event.id },
        {
          dateTime: new Date(Date.now() - 86400_000).toISOString(),
          teamOneName: "Reds",
          teamTwoName: "Blues",
          scoreOne: 2,
          scoreTwo: 2,
          teamsSnapshot,
        },
        "POST",
      ),
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    const history = await prisma.gameHistory.findUnique({ where: { id: body.id } });
    expect(history).not.toBeNull();

    const game = await prisma.game.findUnique({ where: { id: body.id } });
    expect(game).not.toBeNull();
    expect(game!.source).toBe("historical");
    expect(game!.status).toBe("played");
    expect(game!.scoreOne).toBe(2);
    expect(game!.scoreTwo).toBe(2);
    expect(game!.teamOneName).toBe("Reds");
    expect(game!.teamTwoName).toBe("Blues");
    expect(game!.teamOneFormation).toBe("4-4-2");
  });

  it("creates GameParticipant rows from teamsSnapshot", async () => {
    const event = await seedEvent();
    const teamsSnapshot = [
      { team: "Reds", players: [{ name: "Alice", order: 0, slot: 0 }, { name: "Bob", order: 1, slot: 1 }] },
      { team: "Blues", players: [{ name: "Cara", order: 0, slot: 0 }, { name: "Dan", order: 1, slot: 1 }] },
    ];

    const res = await POST_HISTORY(
      ctx(
        { id: event.id },
        {
          dateTime: new Date(Date.now() - 86400_000).toISOString(),
          teamOneName: "Reds",
          teamTwoName: "Blues",
          scoreOne: 1,
          scoreTwo: 0,
          teamsSnapshot,
        },
        "POST",
      ),
    );
    const body = await res.json();

    const participants = await prisma.gameParticipant.findMany({
      where: { gameId: body.id },
      include: { eventPlayer: true },
      orderBy: { order: "asc" },
    });
    expect(participants).toHaveLength(4);
    const alice = participants.find((p) => p.eventPlayer.name === "Alice");
    expect(alice!.team).toBe("Reds");
    expect(alice!.slot).toBe(0);
    const cara = participants.find((p) => p.eventPlayer.name === "Cara");
    expect(cara!.team).toBe("Blues");
    expect(cara!.slot).toBe(0);
  });
});

// ── teams PUT / randomize → GameParticipant + Game ──────────────────────────

describe("teams assignment dual-write to Game", () => {
  it("PUT teams syncs GameParticipant team/slot, Game formations, and a materialized GameHistory snapshot", async () => {
    const event = await seedEvent({ maxPlayers: 4, sport: "football-11v11" });
    const game = await seedGame(event.id, { status: "upcoming" });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
    await seedRoster(event.id, game.id, ["Alice", "Bob", "Cara", "Dan"]);
    await seedHistory(event.id, { id: game.id, dateTime: game.dateTime, status: "played" });

    const res = await PUT_TEAMS(
      ctx(
        { id: event.id },
        {
          matches: [
            { team: "Lions", formation: "4-3-3", players: [{ name: "Alice", order: 0, slot: 0 }, { name: "Bob", order: 1, slot: 1 }] },
            { team: "Tigers", formation: "4-4-2", players: [{ name: "Cara", order: 0, slot: 0 }, { name: "Dan", order: 1, slot: 1 }] },
          ],
        },
        "PUT",
      ),
    );
    expect(res.status).toBe(200);

    const updated = await prisma.game.findUnique({ where: { id: game.id } });
    expect(updated!.teamOneName).toBe("Lions");
    expect(updated!.teamTwoName).toBe("Tigers");
    expect(updated!.teamOneFormation).toBe("4-3-3");
    expect(updated!.teamTwoFormation).toBe("4-4-2");

    const alice = await prisma.gameParticipant.findFirst({
      where: { gameId: game.id, eventPlayer: { name: "Alice" } },
    });
    expect(alice!.team).toBe("Lions");
    expect(alice!.slot).toBe(0);

    const history = await prisma.gameHistory.findUnique({ where: { id: game.id } });
    expect(history).not.toBeNull();
    const snapshot = JSON.parse(history!.teamsSnapshot!);
    expect(snapshot[0].team).toBe("Lions");
    expect(snapshot[1].team).toBe("Tigers");
  });

  it("randomize syncs GameParticipant team and Game formations", async () => {
    const event = await seedEvent({ maxPlayers: 4 });
    const game = await seedGame(event.id, { status: "upcoming" });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
    await seedRoster(event.id, game.id, ["Alice", "Bob", "Cara", "Dan"]);

    const reqCtx = {
      params: { id: event.id },
      url: new URL("http://localhost/api/test"),
      request: new Request("http://localhost/api/test", { method: "POST" }),
    } as any;
    const res = await POST_RANDOMIZE(reqCtx);
    expect(res.status).toBe(200);

    const updated = await prisma.game.findUnique({ where: { id: game.id } });
    expect(updated!.teamOneFormation).toBeTruthy();
    expect(updated!.teamOneName).toBeTruthy();

    const withTeam = await prisma.gameParticipant.count({
      where: { gameId: game.id, team: { not: null } },
    });
    expect(withTeam).toBe(4);
  });
});

// ── approve-elo → Game.eloProcessed ─────────────────────────────────────────

describe("ELO approval dual-write to Game", () => {
  it("sets Game.eloProcessed alongside the history row", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id, { source: "historical", eloProcessed: false, scoreOne: 3, scoreTwo: 1 });
    const game = await seedGame(event.id, { id: history.id, source: "historical", eloProcessed: false, scoreOne: 3, scoreTwo: 1 });

    const res = await POST_APPROVE_ELO(ctx({ id: event.id, historyId: history.id }, {}, "POST"));
    expect(res.status).toBe(200);

    const updatedGame = await prisma.game.findUnique({ where: { id: game.id } });
    expect(updatedGame!.eloProcessed).toBe(true);
    const updatedHistory = await prisma.gameHistory.findUnique({ where: { id: history.id } });
    expect(updatedHistory!.eloProcessed).toBe(true);
  });
});
