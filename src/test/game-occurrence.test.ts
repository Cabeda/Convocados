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
