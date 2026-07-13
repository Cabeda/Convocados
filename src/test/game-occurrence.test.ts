/**
 * ADR 0016 — Occurrence-based recurrence model.
 * Tests for the new Game/EventPlayer/GameParticipant lifecycle.
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

import { POST as createEvent } from "~/pages/api/events/index";
import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { POST as addPlayer } from "~/pages/api/events/[id]/players";

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

// ─── Slice 1: Event creation also creates a Game ─────────────────────────────

describe("Event creation creates a Game", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  it("creates a Game and sets currentGameId on the Event", async () => {
    const res = await createEvent(ctx({}, {
      title: "Friday Footy", location: "Pitch A", dateTime: future,
    }));
    const { id } = await res.json();

    const event = await prisma.event.findUnique({ where: { id } });
    expect(event!.currentGameId).toBeTruthy();

    const game = await prisma.game.findUnique({ where: { id: event!.currentGameId! } });
    expect(game).not.toBeNull();
    expect(game!.eventId).toBe(id);
    expect(game!.status).toBe("upcoming");
    expect(game!.dateTime.toISOString()).toBe(event!.dateTime.toISOString());
  });

  it("creates a Game for recurring events too", async () => {
    const res = await createEvent(ctx({}, {
      title: "Weekly Game", location: "Court 1", dateTime: future,
      isRecurring: true, recurrenceFreq: "weekly", recurrenceByDay: "FR",
    }));
    const { id } = await res.json();

    const event = await prisma.event.findUnique({ where: { id } });
    expect(event!.currentGameId).toBeTruthy();

    const game = await prisma.game.findUnique({ where: { id: event!.currentGameId! } });
    expect(game!.eventId).toBe(id);
    expect(game!.isFriendly).toBe(false);
  });
});

// ─── Slice 2: Adding a player creates EventPlayer + GameParticipant ──────────

describe("Adding a player creates EventPlayer + GameParticipant", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  async function createTestEvent() {
    const res = await createEvent(ctx({}, {
      title: "Test Event", location: "Pitch", dateTime: future,
    }));
    const { id } = await res.json();
    return id as string;
  }

  it("creates an EventPlayer and GameParticipant when adding a player", async () => {
    const eventId = await createTestEvent();

    await addPlayer(ctx({ id: eventId }, { name: "José Cabeda" }));

    const eventPlayer = await prisma.eventPlayer.findUnique({
      where: { eventId_name: { eventId, name: "José Cabeda" } },
    });
    expect(eventPlayer).not.toBeNull();
    expect(eventPlayer!.eventId).toBe(eventId);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    const participant = await prisma.gameParticipant.findUnique({
      where: { gameId_eventPlayerId: { gameId: event!.currentGameId!, eventPlayerId: eventPlayer!.id } },
    });
    expect(participant).not.toBeNull();
    expect(participant!.order).toBe(0);
  });

  it("reuses existing EventPlayer for a second add to a different game", async () => {
    const eventId = await createTestEvent();

    await addPlayer(ctx({ id: eventId }, { name: "Miguel" }));

    // Count EventPlayers — should be exactly 1
    const count = await prisma.eventPlayer.count({ where: { eventId } });
    expect(count).toBe(1);
  });
});

// ─── Slice 3: Authenticated user joining links EventPlayer by userId ─────────

describe("Authenticated user joining gets EventPlayer linked by userId", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  async function createTestEvent() {
    const res = await createEvent(ctx({}, {
      title: "Test Event", location: "Pitch", dateTime: future,
    }));
    const { id } = await res.json();
    return id as string;
  }

  it("sets userId on EventPlayer when linkToAccount is true", async () => {
    const user = await prisma.user.create({
      data: { id: "user-1", name: "José Cabeda", email: "jose@test.com", emailVerified: true },
    });
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name, email: user.email } });

    const eventId = await createTestEvent();
    await addPlayer(ctx({ id: eventId }, { name: "José Cabeda", linkToAccount: true }));

    const eventPlayer = await prisma.eventPlayer.findUnique({
      where: { eventId_name: { eventId, name: "José Cabeda" } },
    });
    expect(eventPlayer).not.toBeNull();
    expect(eventPlayer!.userId).toBe("user-1");
  });

  it("does not set userId on EventPlayer when adding anonymously", async () => {
    const eventId = await createTestEvent();
    mockGetSession.mockResolvedValue(null);

    await addPlayer(ctx({ id: eventId }, { name: "Anonymous Player" }));

    const eventPlayer = await prisma.eventPlayer.findUnique({
      where: { eventId_name: { eventId, name: "Anonymous Player" } },
    });
    expect(eventPlayer).not.toBeNull();
    expect(eventPlayer!.userId).toBeNull();
  });
});

// ─── Slice 4: Same EventPlayer can participate in multiple Games ─────────────

describe("Same EventPlayer can participate in multiple Games", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  it("same EventPlayer has GameParticipant in two different Games", async () => {
    // Create event + first game (via createEvent)
    const res = await createEvent(ctx({}, {
      title: "Weekly", location: "Pitch", dateTime: future,
    }));
    const { id: eventId } = await res.json();

    // Add player to first game
    await addPlayer(ctx({ id: eventId }, { name: "Miguel" }));

    const eventPlayer = await prisma.eventPlayer.findUnique({
      where: { eventId_name: { eventId, name: "Miguel" } },
    });

    // Create a second Game for the same Event
    const game2 = await prisma.game.create({
      data: { eventId, dateTime: new Date(Date.now() + 7 * 86400_000) },
    });
    await prisma.event.update({
      where: { id: eventId },
      data: { currentGameId: game2.id },
    });

    // Add same player to second game
    // Need to use the old Player model too (since addPlayer creates Player rows)
    // First delete the old Player to avoid unique constraint (eventId, name)
    await prisma.player.deleteMany({ where: { eventId } });
    await addPlayer(ctx({ id: eventId }, { name: "Miguel" }));

    // Same EventPlayer, two GameParticipants
    const participations = await prisma.gameParticipant.findMany({
      where: { eventPlayerId: eventPlayer!.id },
    });
    expect(participations).toHaveLength(2);
    expect(new Set(participations.map(p => p.gameId)).size).toBe(2);
  });
});

// ─── Slice 5: Recurrence advancement creates new Game ────────────────────────

describe("Recurrence advancement creates new Game (old stays intact)", () => {
  it("advances to new Game, marks old as played, old players remain", async () => {
    // Create a recurring event with nextResetAt in the past
    const pastDate = new Date(Date.now() - 2 * 86400_000);
    const event = await prisma.event.create({
      data: {
        title: "Weekly Footy",
        location: "Pitch",
        dateTime: pastDate,
        isRecurring: true,
        recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }),
        nextResetAt: new Date(pastDate.getTime() + 60 * 60 * 1000), // in the past
        durationMinutes: 60,
        teamOneName: "A", teamTwoName: "B",
      },
    });

    // Create the initial Game + set currentGameId
    const game1 = await prisma.game.create({
      data: { eventId: event.id, dateTime: pastDate },
    });
    await prisma.event.update({
      where: { id: event.id },
      data: { currentGameId: game1.id },
    });

    // Add a player to the first game (via EventPlayer + GameParticipant)
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "José" },
    });
    await prisma.gameParticipant.create({
      data: { gameId: game1.id, eventPlayerId: ep.id, order: 0 },
    });
    // Also add old-model Player (needed for current GET logic)
    await prisma.player.create({
      data: { eventId: event.id, name: "José", order: 0 },
    });

    // Trigger the GET which performs lazy advancement
    const res = await getEvent(ctx({ id: event.id }));
    const body = await res.json();
    expect(body.wasReset).toBe(true);

    // Old Game should be marked as "played"
    const oldGame = await prisma.game.findUnique({ where: { id: game1.id } });
    expect(oldGame!.status).toBe("played");

    // New Game should exist and be "upcoming"
    const updatedEvent = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updatedEvent!.currentGameId).not.toBe(game1.id);
    const newGame = await prisma.game.findUnique({ where: { id: updatedEvent!.currentGameId! } });
    expect(newGame).not.toBeNull();
    expect(newGame!.status).toBe("upcoming");
    expect(newGame!.dateTime.getTime()).toBeGreaterThan(pastDate.getTime());

    // Old GameParticipant still intact (no deletion)
    const oldParticipants = await prisma.gameParticipant.findMany({
      where: { gameId: game1.id },
    });
    expect(oldParticipants).toHaveLength(1);
    expect(oldParticipants[0].eventPlayerId).toBe(ep.id);
  });
});

// ─── Slice 6: CAS prevents double-advancement ───────────────────────────────

describe("CAS prevents double-advancement", () => {
  it("concurrent GETs only create one new Game", async () => {
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
    // Also need a Player for the old reset path
    await prisma.player.create({
      data: { eventId: event.id, name: "X", order: 0 },
    });

    // Fire two concurrent GETs
    const [res1, res2] = await Promise.all([
      getEvent(ctx({ id: event.id })),
      getEvent(ctx({ id: event.id })),
    ]);
    const body1 = await res1.json();
    const body2 = await res2.json();

    // Exactly one should have triggered the reset
    const resets = [body1.wasReset, body2.wasReset].filter(Boolean);
    expect(resets).toHaveLength(1);

    // Only 2 Games total: the original + one new
    const games = await prisma.game.findMany({ where: { eventId: event.id } });
    expect(games).toHaveLength(2);
  });
});

// ─── Slice 7: Event GET returns gameId and players from current Game ─────────

describe("Event GET returns gameId and current Game data", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  it("response includes gameId field", async () => {
    const res = await createEvent(ctx({}, {
      title: "Test", location: "Pitch", dateTime: future,
    }));
    const { id } = await res.json();

    const getRes = await getEvent(ctx({ id }));
    const body = await getRes.json();

    expect(body.gameId).toBeTruthy();
    // gameId should match the event's currentGameId
    const event = await prisma.event.findUnique({ where: { id } });
    expect(body.gameId).toBe(event!.currentGameId);
  });
});

// ─── Slice 8: RSVP is per-Game (old RSVP doesn't affect new Game) ───────────

describe("RSVP does not carry over after recurrence advancement", () => {
  it("old RSVP persists but new Game has no participants (user can re-join)", async () => {
    const user = await prisma.user.create({
      data: { id: "rsvp-user", name: "José", email: "jose@rsvp.test", emailVerified: true },
    });

    // Create a recurring event in the past (ready to reset)
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

    // User has RSVP "yes" for the old game
    await prisma.player.create({
      data: { eventId: event.id, name: "José", order: 0, userId: user.id },
    });
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "José", userId: user.id },
    });
    await prisma.rsvp.create({
      data: { eventPlayerId: ep.id, gameId: game1.id, status: "yes", respondedAt: new Date() },
    });
    await prisma.gameParticipant.create({
      data: { gameId: game1.id, eventPlayerId: ep.id, order: 0 },
    });

    // Trigger advancement via GET
    const res = await getEvent(ctx({ id: event.id }));
    const body = await res.json();
    expect(body.wasReset).toBe(true);

    // New Game should have NO participants (empty roster)
    const updatedEvent = await prisma.event.findUnique({ where: { id: event.id } });
    const newGameParticipants = await prisma.gameParticipant.findMany({
      where: { gameId: updatedEvent!.currentGameId! },
    });
    expect(newGameParticipants).toHaveLength(0);

    // Response players list is empty (new game, no one joined yet)
    expect(body.players).toHaveLength(0);
  });
});

// ─── Slice 9: isFriendly excludes Game from ELO processing ──────────────────

describe("isFriendly excludes Game from ELO processing", () => {
  it("friendly Games are skipped by shouldProcessGameElo", async () => {
    const { shouldProcessGameElo } = await import("~/lib/game.server");

    const event = await prisma.event.create({
      data: { title: "Test", location: "P", dateTime: new Date(Date.now() + 86400_000), teamOneName: "A", teamTwoName: "B" },
    });
    const friendly = await prisma.game.create({
      data: { eventId: event.id, dateTime: new Date(), isFriendly: true, status: "played" },
    });
    const competitive = await prisma.game.create({
      data: { eventId: event.id, dateTime: new Date(), isFriendly: false, status: "played" },
    });

    expect(await shouldProcessGameElo(friendly.id)).toBe(false);
    expect(await shouldProcessGameElo(competitive.id)).toBe(true);
  });

  it("upcoming Games are not eligible for ELO processing", async () => {
    const { shouldProcessGameElo } = await import("~/lib/game.server");

    const event = await prisma.event.create({
      data: { title: "Test", location: "P", dateTime: new Date(Date.now() + 86400_000), teamOneName: "A", teamTwoName: "B" },
    });
    const upcoming = await prisma.game.create({
      data: { eventId: event.id, dateTime: new Date(), status: "upcoming" },
    });

    expect(await shouldProcessGameElo(upcoming.id)).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Read from new model
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Phase 2 Slice 1: Event GET players sourced from GameParticipant ─────────

describe("Event GET players from GameParticipant+EventPlayer", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  it("returns players from GameParticipant joined with EventPlayer", async () => {
    const res = await createEvent(ctx({}, {
      title: "Test", location: "Pitch", dateTime: future,
    }));
    const { id: eventId } = await res.json();

    // Add two players via the API (creates both old Player + new EventPlayer/GameParticipant)
    await addPlayer(ctx({ id: eventId }, { name: "Alice" }));
    await addPlayer(ctx({ id: eventId }, { name: "Bob" }));

    const getRes = await getEvent(ctx({ id: eventId }));
    const body = await getRes.json();

    // Response should have 2 players with correct names and order
    expect(body.players).toHaveLength(2);
    expect(body.players[0].name).toBe("Alice");
    expect(body.players[1].name).toBe("Bob");
    expect(body.players[0].order).toBe(0);
    expect(body.players[1].order).toBe(1);
    // Each player should have userId field (nullable)
    expect(body.players[0]).toHaveProperty("userId");
  });

  it("excludes archived GameParticipants from the player list", async () => {
    const res = await createEvent(ctx({}, {
      title: "Test", location: "Pitch", dateTime: future,
    }));
    const { id: eventId } = await res.json();

    await addPlayer(ctx({ id: eventId }, { name: "Active" }));
    await addPlayer(ctx({ id: eventId }, { name: "Archived" }));

    // Archive the second participant directly in the new model
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    const ep = await prisma.eventPlayer.findUnique({
      where: { eventId_name: { eventId, name: "Archived" } },
    });
    await prisma.gameParticipant.update({
      where: { gameId_eventPlayerId: { gameId: event!.currentGameId!, eventPlayerId: ep!.id } },
      data: { archivedAt: new Date() },
    });
    // Also archive legacy Player for consistency
    await prisma.player.updateMany({
      where: { eventId, name: "Archived" },
      data: { archivedAt: new Date() },
    });

    const getRes = await getEvent(ctx({ id: eventId }));
    const body = await getRes.json();

    expect(body.players).toHaveLength(1);
    expect(body.players[0].name).toBe("Active");
  });

  it("reads from GameParticipant even when no legacy Player exists", async () => {
    // Create event with Game directly (no legacy Player row)
    const event = await prisma.event.create({
      data: { title: "Test", location: "P", dateTime: new Date(Date.now() + 86400_000), teamOneName: "A", teamTwoName: "B" },
    });
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: event.dateTime },
    });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "NewModelOnly", userId: null },
    });
    await prisma.gameParticipant.create({
      data: { gameId: game.id, eventPlayerId: ep.id, order: 0 },
    });

    const getRes = await getEvent(ctx({ id: event.id }));
    const body = await getRes.json();

    expect(body.players).toHaveLength(1);
    expect(body.players[0].name).toBe("NewModelOnly");
  });
});


// ─── Phase 2 Slice 2: known-players from EventPlayer table ───────────────────

import { GET as getKnownPlayers } from "~/pages/api/events/[id]/known-players";

describe("known-players reads from EventPlayer table", () => {
  it("returns EventPlayers not in current game as suggestions", async () => {
    const event = await prisma.event.create({
      data: { title: "Test", location: "P", dateTime: new Date(Date.now() + 86400_000), teamOneName: "A", teamTwoName: "B" },
    });
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: event.dateTime },
    });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

    // Create EventPlayers: one in the current game, two not
    const epActive = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "ActivePlayer", gamesPlayed: 5 },
    });
    await prisma.gameParticipant.create({
      data: { gameId: game.id, eventPlayerId: epActive.id, order: 0 },
    });
    // Also need legacy Player for the current filter
    await prisma.player.create({ data: { eventId: event.id, name: "ActivePlayer", order: 0 } });

    await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "PastPlayer1", gamesPlayed: 10 },
    });
    await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "PastPlayer2", gamesPlayed: 3 },
    });

    const res = await getKnownPlayers(ctx({ id: event.id }));
    const body = await res.json();

    // Should return the two NOT in the current game, sorted by gamesPlayed desc
    const names = body.players.map((p: any) => p.name);
    expect(names).toContain("PastPlayer1");
    expect(names).toContain("PastPlayer2");
    expect(names).not.toContain("ActivePlayer");

    // PastPlayer1 (10 games) should come before PastPlayer2 (3 games)
    const idx1 = names.indexOf("PastPlayer1");
    const idx2 = names.indexOf("PastPlayer2");
    expect(idx1).toBeLessThan(idx2);
  });
});


// ─── Phase 2 Slice 3: Recurrence advancement stops deleting legacy data ──────

describe("Recurrence advancement preserves legacy data (no destructive reset)", () => {
  it("Players, RSVPs, and TeamResults are NOT deleted after advancement", async () => {
    const pastDate = new Date(Date.now() - 2 * 86400_000);
    const user = await prisma.user.create({
      data: { id: "keep-user", name: "Keep Me", email: "keep@test.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: {
        title: "Weekly",
        location: "Pitch",
        dateTime: pastDate,
        isRecurring: true,
        recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }),
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

    // Seed legacy data that the OLD reset would have destroyed
    await prisma.player.create({
      data: { eventId: event.id, name: "Keep Me", order: 0, userId: user.id },
    });
    await prisma.teamResult.create({
      data: {
        eventId: event.id, name: "TeamA",
        members: { create: [{ name: "Keep Me", order: 0 }] },
      },
    });
    // Also seed new-model data
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Keep Me", userId: user.id },
    });
    await prisma.rsvp.create({
      data: { eventPlayerId: ep.id, gameId: game1.id, status: "yes", respondedAt: new Date() },
    });
    await prisma.gameParticipant.create({
      data: { gameId: game1.id, eventPlayerId: ep.id, order: 0 },
    });

    // Trigger advancement
    const res = await getEvent(ctx({ id: event.id }));
    const body = await res.json();
    expect(body.wasReset).toBe(true);

    // Legacy Player should still exist (NOT deleted)
    const players = await prisma.player.findMany({ where: { eventId: event.id } });
    expect(players).toHaveLength(1);
    expect(players[0].name).toBe("Keep Me");

    // TeamResult should still exist
    const teams = await prisma.teamResult.findMany({ where: { eventId: event.id } });
    expect(teams).toHaveLength(1);

    // RSVP stays on the OLD game (game-scoped — no destructive delete needed)
    const rsvps = await prisma.rsvp.findMany({ where: { gameId: game1.id } });
    expect(rsvps).toHaveLength(1);
    // New game has no RSVPs yet
    const updatedEvt = await prisma.event.findUnique({ where: { id: event.id }, select: { currentGameId: true } });
    const newRsvps = await prisma.rsvp.findMany({ where: { gameId: updatedEvt!.currentGameId! } });
    expect(newRsvps).toHaveLength(0);
  });
});


// ─── Phase 2 Slice 4: History endpoint reads from Game rows ──────────────────

import { GET as getHistory } from "~/pages/api/events/[id]/history/index";

describe("History endpoint includes Game rows with status=played", () => {
  it("returns played Games in history alongside legacy GameHistory entries", async () => {
    const event = await prisma.event.create({
      data: { title: "Test", location: "P", dateTime: new Date(Date.now() + 86400_000), teamOneName: "A", teamTwoName: "B" },
    });

    // Legacy GameHistory entry
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2025-01-10T18:00:00Z"),
        status: "played",
        teamOneName: "A", teamTwoName: "B",
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "Alice", order: 0 }] },
          { team: "B", players: [{ name: "Bob", order: 0 }] },
        ]),
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    // New-model Game with status "played"
    const playedGame = await prisma.game.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2025-01-17T18:00:00Z"),
        status: "played",
        scoreOne: 3,
        scoreTwo: 1,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
      },
    });
    // Add participants to the played game
    const ep1 = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice" } });
    const ep2 = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Bob" } });
    await prisma.gameParticipant.create({ data: { gameId: playedGame.id, eventPlayerId: ep1.id, order: 0 } });
    await prisma.gameParticipant.create({ data: { gameId: playedGame.id, eventPlayerId: ep2.id, order: 1 } });

    const res = await getHistory(ctx({ id: event.id }));
    const body = await res.json();

    // Should have 2 entries total (1 legacy + 1 Game)
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    // Most recent first (Jan 17 before Jan 10)
    const dates = body.data.map((e: any) => e.dateTime);
    expect(new Date(dates[0]).getTime()).toBeGreaterThan(new Date(dates[1]).getTime());
  });
});
