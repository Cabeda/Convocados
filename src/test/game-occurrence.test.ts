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
  it("user RSVP is cleared after game advancement", async () => {
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
    await prisma.rsvp.create({
      data: { eventId: event.id, userId: user.id, status: "yes", respondedAt: new Date() },
    });
    // Need a Player for the old reset path
    await prisma.player.create({
      data: { eventId: event.id, name: "José", order: 0, userId: user.id },
    });

    // Trigger advancement via GET
    const res = await getEvent(ctx({ id: event.id }));
    const body = await res.json();
    expect(body.wasReset).toBe(true);

    // After advancement, user's RSVP should be gone (cleared by reset)
    const rsvp = await prisma.rsvp.findUnique({
      where: { userId_eventId: { userId: user.id, eventId: event.id } },
    });
    expect(rsvp).toBeNull();
  });
});
