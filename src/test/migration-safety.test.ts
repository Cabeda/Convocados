/**
 * ADR 0016 — Migration safety tests.
 * Verify backward compatibility: existing events without currentGameId,
 * data integrity during recurrence advancement, and edge cases.
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

import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { POST as addPlayer } from "~/pages/api/events/[id]/players";
import { GET as getKnownPlayers } from "~/pages/api/events/[id]/known-players";
import { GET as getHistory } from "~/pages/api/events/[id]/history/index";

function ctx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Migration safety: pre-existing events without currentGameId
// ═══════════════════════════════════════════════════════════════════════════════

describe("Backward compat: events without currentGameId", () => {
  it("Event GET returns players from legacy Player table when currentGameId is null", async () => {
    // Simulate a pre-migration event (no Game, no currentGameId)
    const event = await prisma.event.create({
      data: {
        title: "Legacy Event", location: "Old Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A", teamTwoName: "B",
        // currentGameId remains null
      },
    });
    await prisma.player.create({ data: { eventId: event.id, name: "LegacyPlayer", order: 0 } });

    const res = await getEvent(ctx({ id: event.id }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.players).toHaveLength(1);
    expect(body.players[0].name).toBe("LegacyPlayer");
    expect(body.gameId).toBeNull();
  });

  it("known-players falls back to legacy Player for current-player exclusion", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Legacy", location: "P",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A", teamTwoName: "B",
      },
    });
    await prisma.player.create({ data: { eventId: event.id, name: "InGame", order: 0 } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "InGame", gamesPlayed: 5 } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "NotInGame", gamesPlayed: 3 } });

    const res = await getKnownPlayers(ctx({ id: event.id }));
    const body = await res.json();

    const names = body.players.map((p: any) => p.name);
    expect(names).not.toContain("InGame");
    expect(names).toContain("NotInGame");
  });

  it("history endpoint still reads GameHistory for legacy events", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Legacy", location: "P",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A", teamTwoName: "B",
      },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2025-01-01T18:00:00Z"),
        status: "played",
        teamOneName: "A", teamTwoName: "B",
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "X", order: 0 }] },
          { team: "B", players: [{ name: "Y", order: 0 }] },
        ]),
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    const res = await getHistory(ctx({ id: event.id }));
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe("played");
  });

  it("addPlayer still works for events without currentGameId (legacy only)", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Legacy", location: "P",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A", teamTwoName: "B",
      },
    });

    const res = await addPlayer(ctx({ id: event.id }, { name: "NewPlayer" }));
    expect(res.status).toBe(200);

    // Legacy Player should be created
    const player = await prisma.player.findUnique({
      where: { eventId_name: { eventId: event.id, name: "NewPlayer" } },
    });
    expect(player).not.toBeNull();

    // No EventPlayer/GameParticipant created (no currentGameId)
    const ep = await prisma.eventPlayer.findUnique({
      where: { eventId_name: { eventId: event.id, name: "NewPlayer" } },
    });
    expect(ep).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Data integrity: recurrence advancement preserves all data
// ═══════════════════════════════════════════════════════════════════════════════

describe("Data integrity during recurrence advancement", () => {
  it("all player data preserved: old Game participants, EventPlayers, teams, RSVPs stay intact", async () => {
    const user = await prisma.user.create({
      data: { id: "integrity-user", name: "José", email: "jose@integrity.test", emailVerified: true },
    });

    const pastDate = new Date(Date.now() - 2 * 86400_000);
    const event = await prisma.event.create({
      data: {
        title: "Weekly",
        location: "Pitch",
        dateTime: pastDate,
        isRecurring: true,
        recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }),
        nextResetAt: new Date(pastDate.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        teamOneName: "Ninjas", teamTwoName: "Gunas",
      },
    });

    const game1 = await prisma.game.create({
      data: { eventId: event.id, dateTime: pastDate },
    });
    await prisma.event.update({
      where: { id: event.id },
      data: { currentGameId: game1.id },
    });

    // Set up rich data: players, teams, RSVPs, EventPlayers
    await prisma.player.create({ data: { eventId: event.id, name: "José", order: 0, userId: user.id } });
    await prisma.player.create({ data: { eventId: event.id, name: "Miguel", order: 1 } });
    await prisma.teamResult.create({
      data: {
        eventId: event.id, name: "Ninjas",
        members: { create: [{ name: "José", order: 0 }, { name: "Miguel", order: 1 }] },
      },
    });
    await prisma.rsvp.create({
      data: { eventId: event.id, userId: user.id, status: "yes", respondedAt: new Date() },
    });

    const ep1 = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "José", userId: user.id } });
    const ep2 = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Miguel" } });
    await prisma.gameParticipant.create({ data: { gameId: game1.id, eventPlayerId: ep1.id, order: 0 } });
    await prisma.gameParticipant.create({ data: { gameId: game1.id, eventPlayerId: ep2.id, order: 1 } });

    // Record counts BEFORE advancement
    const beforePlayers = await prisma.player.count({ where: { eventId: event.id } });
    const beforeTeams = await prisma.teamResult.count({ where: { eventId: event.id } });
    const beforeRsvps = await prisma.rsvp.count({ where: { eventId: event.id } });
    const beforeEventPlayers = await prisma.eventPlayer.count({ where: { eventId: event.id } });
    const beforeParticipants = await prisma.gameParticipant.count({ where: { gameId: game1.id } });

    // Trigger advancement
    const res = await getEvent(ctx({ id: event.id }));
    const body = await res.json();
    expect(body.wasReset).toBe(true);

    // Verify NO data was lost
    const afterPlayers = await prisma.player.count({ where: { eventId: event.id } });
    const afterTeams = await prisma.teamResult.count({ where: { eventId: event.id } });
    const afterRsvps = await prisma.rsvp.count({ where: { eventId: event.id } });
    const afterEventPlayers = await prisma.eventPlayer.count({ where: { eventId: event.id } });
    const afterParticipants = await prisma.gameParticipant.count({ where: { gameId: game1.id } });

    expect(afterPlayers).toBe(beforePlayers);
    expect(afterTeams).toBe(beforeTeams);
    expect(afterRsvps).toBe(beforeRsvps);
    expect(afterEventPlayers).toBe(beforeEventPlayers);
    expect(afterParticipants).toBe(beforeParticipants);

    // Old Game is now "played"
    const oldGame = await prisma.game.findUnique({ where: { id: game1.id } });
    expect(oldGame!.status).toBe("played");

    // New Game exists and is empty
    const updatedEvent = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updatedEvent!.currentGameId).not.toBe(game1.id);
    const newParticipants = await prisma.gameParticipant.count({
      where: { gameId: updatedEvent!.currentGameId! },
    });
    expect(newParticipants).toBe(0);

    // GameHistory was still created (backward compat)
    const history = await prisma.gameHistory.count({ where: { eventId: event.id } });
    expect(history).toBe(1);
  });

  it("multiple advancements preserve all historical Games", async () => {
    const pastDate = new Date(Date.now() - 14 * 86400_000);
    const event = await prisma.event.create({
      data: {
        title: "Weekly",
        location: "Pitch",
        dateTime: pastDate,
        isRecurring: true,
        recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1 }),
        nextResetAt: new Date(pastDate.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        teamOneName: "A", teamTwoName: "B",
      },
    });
    const game1 = await prisma.game.create({
      data: { eventId: event.id, dateTime: pastDate },
    });
    await prisma.event.update({
      where: { id: event.id },
      data: { currentGameId: game1.id },
    });
    await prisma.player.create({ data: { eventId: event.id, name: "X", order: 0 } });

    // First advancement
    const res1 = await getEvent(ctx({ id: event.id }));
    const body1 = await res1.json();
    expect(body1.wasReset).toBe(true);

    // Set up for second advancement
    await prisma.event.update({
      where: { id: event.id },
      data: { nextResetAt: new Date(Date.now() - 1000) }, // force next reset
    });

    // Second advancement
    const res2 = await getEvent(ctx({ id: event.id }));
    const body2 = await res2.json();
    expect(body2.wasReset).toBe(true);

    // Should have 3 Games total: original + 2 advancements
    const games = await prisma.game.findMany({ where: { eventId: event.id } });
    expect(games).toHaveLength(3);

    // 2 should be "played", 1 should be "upcoming"
    const played = games.filter((g) => g.status === "played");
    const upcoming = games.filter((g) => g.status === "upcoming");
    expect(played).toHaveLength(2);
    expect(upcoming).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("non-recurring event with currentGameId never triggers advancement", async () => {
    const event = await prisma.event.create({
      data: {
        title: "One-off", location: "P",
        dateTime: new Date(Date.now() - 86400_000), // in the past
        isRecurring: false,
        teamOneName: "A", teamTwoName: "B",
      },
    });
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: event.dateTime },
    });
    await prisma.event.update({
      where: { id: event.id },
      data: { currentGameId: game.id },
    });

    const res = await getEvent(ctx({ id: event.id }));
    const body = await res.json();

    expect(body.wasReset).toBe(false);
    expect(body.gameId).toBe(game.id);
    // Only 1 Game
    const games = await prisma.game.findMany({ where: { eventId: event.id } });
    expect(games).toHaveLength(1);
  });

  it("Event GET works for event with 0 players (empty game)", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Empty", location: "P",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A", teamTwoName: "B",
      },
    });
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: event.dateTime },
    });
    await prisma.event.update({
      where: { id: event.id },
      data: { currentGameId: game.id },
    });

    const res = await getEvent(ctx({ id: event.id }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.players).toEqual([]);
    expect(body.gameId).toBe(game.id);
  });
});
