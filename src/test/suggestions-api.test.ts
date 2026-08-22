import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/events/[id]/suggestions";
import { getSession } from "~/lib/auth.helpers.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);
const mockAuthenticateRequest = vi.mocked(authenticateRequest);

const DAY_MS = 86_400_000;

beforeEach(async () => {
  await prisma.playerInvite.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
});

function ctx(eventId: string) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/suggestions`, { method: "GET" }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/suggestions`),
  } as any;
}

function mockAuth(userId: string) {
  mockAuthenticateRequest.mockResolvedValue({ userId, scopes: ["*"], authMethod: "oauth" });
}

async function seedUser(id: string, name = "User") {
  return prisma.user.create({
    data: { id, name, email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      id: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: "Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 7 * DAY_MS),
      maxPlayers: 10,
      ...overrides,
    },
  });
}

async function seedEventPlayer(
  eventId: string,
  userId: string,
  name: string,
  gamesPlayed = 0,
) {
  return prisma.eventPlayer.create({
    data: { eventId, userId, name, gamesPlayed },
  });
}

/** Create a Game in the event with the given active participants, and set it as the event's currentGameId if requested. */
async function seedGame(
  eventId: string,
  dateTime: Date,
  participantEventPlayerIds: string[],
  opts: { makeCurrent?: boolean } = {},
) {
  const game = await prisma.game.create({ data: { eventId, dateTime } });
  for (const eventPlayerId of participantEventPlayerIds) {
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId } });
  }
  if (opts.makeCurrent) {
    await prisma.event.update({ where: { id: eventId }, data: { currentGameId: game.id } });
  }
  return game;
}

async function seedPlayerInvite(
  gameId: string,
  eventPlayerId: string,
  invitedByUserId: string,
  status: any = "pending",
) {
  return prisma.playerInvite.create({
    data: {
      gameId,
      eventPlayerId,
      invitedByUserId,
      status,
      token: `tok-${Math.random().toString(36).slice(2, 14)}`,
    },
  });
}

/**
 * Standard scenario: inviter + one candidate co-played once in a past game of
 * the event; the event has a current game with only the inviter participating.
 * Returns ids so individual tests can add an exclusion.
 */
async function seedStandardPair(inviterId: string, candidateId: string, candidateName: string) {
  const event = await seedEvent();
  const inviterEp = await seedEventPlayer(event.id, inviterId, "Inviter");
  const candidateEp = await seedEventPlayer(event.id, candidateId, candidateName);
  await seedGame(event.id, new Date(Date.now() - 2 * DAY_MS), [inviterEp.id, candidateEp.id]);
  const current = await seedGame(event.id, new Date(Date.now() + 1 * DAY_MS), [inviterEp.id], {
    makeCurrent: true,
  });
  return { event, inviterEp, candidateEp, currentGame: current };
}

describe("GET /api/events/:id/suggestions", () => {
  it("returns 401 when unauthenticated", async () => {
    const event = await seedEvent();
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await GET(ctx(event.id));
    expect(res.status).toBe(401);
  });

  it("returns suggestions ranked by co-play score descending (frequency x recency)", async () => {
    const inviter = await seedUser("inviter-rank", "Inviter");
    const a = await seedUser("cand-a", "Alice");
    const b = await seedUser("cand-b", "Bob");
    const c = await seedUser("cand-c", "Carol");
    const event = await seedEvent();
    const inviterEp = await seedEventPlayer(event.id, inviter.id, "Inviter");
    const aEp = await seedEventPlayer(event.id, a.id, "Alice", 10);
    const bEp = await seedEventPlayer(event.id, b.id, "Bob", 5);
    const cEp = await seedEventPlayer(event.id, c.id, "Carol", 2);

    // A: 10 games, very recent
    for (let i = 0; i < 10; i++) {
      await seedGame(event.id, new Date(Date.now() - 1 * DAY_MS), [inviterEp.id, aEp.id]);
    }
    // B: 5 games, ~30 days ago
    for (let i = 0; i < 5; i++) {
      await seedGame(event.id, new Date(Date.now() - 30 * DAY_MS), [inviterEp.id, bEp.id]);
    }
    // C: 2 games, ~180 days ago
    for (let i = 0; i < 2; i++) {
      await seedGame(event.id, new Date(Date.now() - 180 * DAY_MS), [inviterEp.id, cEp.id]);
    }
    // current game: inviter only
    await seedGame(event.id, new Date(Date.now() + 1 * DAY_MS), [inviterEp.id], { makeCurrent: true });

    mockAuth(inviter.id);
    const res = await GET(ctx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.suggestions.map((s: { userId: string }) => s.userId)).toEqual([a.id, b.id, c.id]);
    expect(body.suggestions[0].score).toBeGreaterThan(body.suggestions[1].score);
    expect(body.suggestions[1].score).toBeGreaterThan(body.suggestions[2].score);
    expect(body.suggestions[0].coPlayCount).toBe(10);
    expect(body.suggestions[1].coPlayCount).toBe(5);
    expect(body.suggestions[2].coPlayCount).toBe(2);
  });

  describe("hard exclusions", () => {
    it("excludes a candidate whose global invitesEnabled is false", async () => {
      const inviter = await seedUser("inviter-global");
      const candidate = await seedUser("cand-global", "Excluded");
      const { event } = await seedStandardPair(inviter.id, candidate.id, "Excluded");
      await prisma.notificationPreferences.create({
        data: { userId: candidate.id, invitesEnabled: false },
      });

      mockAuth(inviter.id);
      const res = await GET(ctx(event.id));
      const body = await res.json();
      expect(body.suggestions).toEqual([]);
    });

    it("excludes a candidate with per-event invitationOptOutAt set", async () => {
      const inviter = await seedUser("inviter-optout");
      const candidate = await seedUser("cand-optout", "OptedOut");
      const { event, candidateEp } = await seedStandardPair(inviter.id, candidate.id, "OptedOut");
      await prisma.eventPlayer.update({
        where: { id: candidateEp.id },
        data: { invitationOptOutAt: new Date() },
      });

      mockAuth(inviter.id);
      const res = await GET(ctx(event.id));
      const body = await res.json();
      expect(body.suggestions).toEqual([]);
    });

    it("excludes a candidate already invited pending for this game", async () => {
      const inviter = await seedUser("inviter-pending");
      const candidate = await seedUser("cand-pending", "PendingInvited");
      const { event, candidateEp, currentGame } = await seedStandardPair(
        inviter.id,
        candidate.id,
        "PendingInvited",
      );
      await seedPlayerInvite(currentGame.id, candidateEp.id, inviter.id, "pending");

      mockAuth(inviter.id);
      const res = await GET(ctx(event.id));
      const body = await res.json();
      expect(body.suggestions).toEqual([]);
    });

    it("excludes a candidate who RSVP'd no for this game", async () => {
      const inviter = await seedUser("inviter-rsvp");
      const candidate = await seedUser("cand-rsvp", "RsvpNo");
      const { event, candidateEp, currentGame } = await seedStandardPair(inviter.id, candidate.id, "RsvpNo");
      await prisma.rsvp.create({
        data: { gameId: currentGame.id, eventPlayerId: candidateEp.id, status: "no" },
      });

      mockAuth(inviter.id);
      const res = await GET(ctx(event.id));
      const body = await res.json();
      expect(body.suggestions).toEqual([]);
    });

    it("excludes a candidate already joined (active participant in) this game", async () => {
      const inviter = await seedUser("inviter-joined");
      const candidate = await seedUser("cand-joined", "AlreadyJoined");
      const { event, candidateEp, currentGame } = await seedStandardPair(inviter.id, candidate.id, "AlreadyJoined");
      await prisma.gameParticipant.create({
        data: { gameId: currentGame.id, eventPlayerId: candidateEp.id, status: "active" },
      });

      mockAuth(inviter.id);
      const res = await GET(ctx(event.id));
      const body = await res.json();
      expect(body.suggestions).toEqual([]);
    });

    it("excludes a candidate with noShowStreak >= 2 on this event", async () => {
      const inviter = await seedUser("inviter-noshow");
      const candidate = await seedUser("cand-noshow", "NoShow");
      const { event } = await seedStandardPair(inviter.id, candidate.id, "NoShow");
      await prisma.priorityEnrollment.create({
        data: { eventId: event.id, userId: candidate.id, noShowStreak: 2 },
      });

      mockAuth(inviter.id);
      const res = await GET(ctx(event.id));
      const body = await res.json();
      expect(body.suggestions).toEqual([]);
    });

    it("keeps a candidate when no exclusion applies", async () => {
      const inviter = await seedUser("inviter-keep");
      const candidate = await seedUser("cand-keep", "Kept");
      const { event } = await seedStandardPair(inviter.id, candidate.id, "Kept");

      mockAuth(inviter.id);
      const res = await GET(ctx(event.id));
      const body = await res.json();
      expect(body.suggestions).toHaveLength(1);
      expect(body.suggestions[0].userId).toBe(candidate.id);
      expect(body.suggestions[0].invitedPending).toBe(false);
    });
  });

  it("sinks a candidate with >=3 declined invites on the event below a fresh candidate with the same co-play count", async () => {
    const inviter = await seedUser("inviter-decline");
    const declining = await seedUser("cand-declining", "Declining");
    const fresh = await seedUser("cand-fresh", "Fresh");
    const event = await seedEvent();
    const inviterEp = await seedEventPlayer(event.id, inviter.id, "Inviter");
    const decliningEp = await seedEventPlayer(event.id, declining.id, "Declining");
    const freshEp = await seedEventPlayer(event.id, fresh.id, "Fresh");

    // Same recency, same co-play count → identical base score before penalty.
    for (let i = 0; i < 3; i++) {
      await seedGame(event.id, new Date(Date.now() - 3 * DAY_MS), [inviterEp.id, decliningEp.id]);
      await seedGame(event.id, new Date(Date.now() - 3 * DAY_MS), [inviterEp.id, freshEp.id]);
    }
    // Declining has 3 declined invites across the event's games.
    for (let i = 0; i < 3; i++) {
      const game = await prisma.game.create({
        data: { eventId: event.id, dateTime: new Date(Date.now() - 3 * DAY_MS) },
      });
      await seedPlayerInvite(game.id, decliningEp.id, inviter.id, "declined");
    }
    await seedGame(event.id, new Date(Date.now() + 1 * DAY_MS), [inviterEp.id], { makeCurrent: true });

    mockAuth(inviter.id);
    const res = await GET(ctx(event.id));
    const body = await res.json();

    expect(body.suggestions.map((s: { userId: string }) => s.userId)).toEqual([fresh.id, declining.id]);
    expect(body.suggestions[0].score).toBeGreaterThan(body.suggestions[1].score);
    expect(body.suggestions[1].score).toBeCloseTo(body.suggestions[0].score * 0.1, 5);
  });

  it("returns empty suggestions when the inviter has no co-play history", async () => {
    const inviter = await seedUser("inviter-lonely");
    const event = await seedEvent();
    const inviterEp = await seedEventPlayer(event.id, inviter.id, "Inviter");
    await seedGame(event.id, new Date(Date.now() + 1 * DAY_MS), [inviterEp.id], { makeCurrent: true });

    mockAuth(inviter.id);
    const res = await GET(ctx(event.id));
    const body = await res.json();
    expect(body.suggestions).toEqual([]);
  });

  it("returns empty when the event has no current game", async () => {
    const inviter = await seedUser("inviter-nocurrent");
    const event = await seedEvent(); // no currentGameId set
    const inviterEp = await seedEventPlayer(event.id, inviter.id, "Inviter");
    await seedGame(event.id, new Date(Date.now() + 1 * DAY_MS), [inviterEp.id]);

    mockAuth(inviter.id);
    const res = await GET(ctx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestions).toEqual([]);
  });

  it("returns empty when the inviter has no player record on any event", async () => {
    const inviter = await seedUser("inviter-noep");
    const other = await seedUser("other", "Other");
    const event = await seedEvent();
    const otherEp = await seedEventPlayer(event.id, other.id, "Other");
    await seedGame(event.id, new Date(Date.now() + 1 * DAY_MS), [otherEp.id], { makeCurrent: true });

    mockAuth(inviter.id);
    const res = await GET(ctx(event.id));
    const body = await res.json();
    expect(body.suggestions).toEqual([]);
  });

  it("returns empty when the inviter has player records but no participations", async () => {
    const inviter = await seedUser("inviter-noplay");
    const other = await seedUser("other2", "Other");
    const event = await seedEvent();
    await seedEventPlayer(event.id, inviter.id, "Inviter"); // player record, no participations
    const otherEp = await seedEventPlayer(event.id, other.id, "Other");
    await seedGame(event.id, new Date(Date.now() + 1 * DAY_MS), [otherEp.id], { makeCurrent: true });

    mockAuth(inviter.id);
    const res = await GET(ctx(event.id));
    const body = await res.json();
    expect(body.suggestions).toEqual([]);
  });
});
