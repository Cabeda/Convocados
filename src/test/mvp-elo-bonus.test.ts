import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { MVP_ELO_BONUS } from "~/lib/mvp.constants";

// Mock auth
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

import { processGame } from "~/lib/elo.server";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() - 3600_000),
      durationMinutes: 30,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
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
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      teamsSnapshot: JSON.stringify([
        { team: "Ninjas", players: [{ name: "Alice", order: 0 }, { name: "Bob", order: 1 }] },
        { team: "Gunas", players: [{ name: "Charlie", order: 0 }, { name: "Dave", order: 1 }] },
      ]),
      scoreOne: 3,
      scoreTwo: 1,
      editableUntil: new Date(Date.now() + 86400_000),
      ...overrides,
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.mvpVote.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ─── processGame with MVP ELO bonus ─────────────────────────────────────────

describe("processGame MVP ELO bonus", () => {
  it("applies ELO bonus to the MVP when mvpEloEnabled is true", async () => {
    const event = await seedEvent({ mvpEloEnabled: true, eloEnabled: true });
    const history = await seedHistory(event.id);

    // Alice and Charlie vote for Bob
    await prisma.mvpVote.create({
      data: { gameHistoryId: history.id, voterPlayerId: "p1", voterName: "Alice", votedForPlayerId: "p2", votedForName: "Bob" },
    });
    await prisma.mvpVote.create({
      data: { gameHistoryId: history.id, voterPlayerId: "p3", voterName: "Charlie", votedForPlayerId: "p2", votedForName: "Bob" },
    });

    const updates = await processGame(
      event.id,
      history.id,
      JSON.parse(history.teamsSnapshot!),
      history.scoreOne!,
      history.scoreTwo!,
    );

    // Check that Bob's update includes the MVP bonus
    const bobUpdate = updates.find((u) => u.name === "Bob");
    expect(bobUpdate).toBeDefined();
    expect(bobUpdate!.delta).toBeGreaterThan(MVP_ELO_BONUS);
    expect(bobUpdate!.newRating).toBe(bobUpdate!.oldRating + bobUpdate!.delta);

    // Verify DB rating includes the bonus
    const bobRating = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId: event.id, name: "Bob" } },
    });
    expect(bobRating).toBeDefined();
    expect(bobRating!.rating).toBe(bobUpdate!.newRating);
  });

  it("does not apply ELO bonus when mvpEloEnabled is false", async () => {
    const event = await seedEvent({ mvpEloEnabled: false, eloEnabled: true });
    const history = await seedHistory(event.id);

    await prisma.mvpVote.create({
      data: { gameHistoryId: history.id, voterPlayerId: "p1", voterName: "Alice", votedForPlayerId: "p2", votedForName: "Bob" },
    });

    const updates = await processGame(
      event.id,
      history.id,
      JSON.parse(history.teamsSnapshot!),
      history.scoreOne!,
      history.scoreTwo!,
    );

    const bobUpdate = updates.find((u) => u.name === "Bob");
    expect(bobUpdate).toBeDefined();
    expect(bobUpdate!.delta).toBeLessThanOrEqual(32); // normal max ELO delta without bonus
    expect(bobUpdate!.newRating).toBe(bobUpdate!.oldRating + bobUpdate!.delta);
  });

  it("applies bonus to co-MVPs on a tie", async () => {
    const event = await seedEvent({ mvpEloEnabled: true, eloEnabled: true });
    const history = await seedHistory(event.id);

    // One vote for Bob, one vote for Alice — tie
    await prisma.mvpVote.create({
      data: { gameHistoryId: history.id, voterPlayerId: "p3", voterName: "Charlie", votedForPlayerId: "p2", votedForName: "Bob" },
    });
    await prisma.mvpVote.create({
      data: { gameHistoryId: history.id, voterPlayerId: "p4", voterName: "Dave", votedForPlayerId: "p1", votedForName: "Alice" },
    });

    const updates = await processGame(
      event.id,
      history.id,
      JSON.parse(history.teamsSnapshot!),
      history.scoreOne!,
      history.scoreTwo!,
    );

    const aliceUpdate = updates.find((u) => u.name === "Alice");
    const bobUpdate = updates.find((u) => u.name === "Bob");
    expect(aliceUpdate!.delta).toBeGreaterThan(MVP_ELO_BONUS);
    expect(bobUpdate!.delta).toBeGreaterThan(MVP_ELO_BONUS);

    const aliceRating = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId: event.id, name: "Alice" } },
    });
    const bobRating = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId: event.id, name: "Bob" } },
    });
    expect(aliceRating!.rating).toBe(aliceUpdate!.newRating);
    expect(bobRating!.rating).toBe(bobUpdate!.newRating);
  });

  it("does nothing when there are no MVP votes", async () => {
    const event = await seedEvent({ mvpEloEnabled: true, eloEnabled: true });
    const history = await seedHistory(event.id);

    const updates = await processGame(
      event.id,
      history.id,
      JSON.parse(history.teamsSnapshot!),
      history.scoreOne!,
      history.scoreTwo!,
    );

    // All deltas should be normal ELO deltas (no bonus)
    for (const u of updates) {
      expect(u.delta).toBeLessThanOrEqual(32);
    }
  });
});
