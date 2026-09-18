import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { MVP_ELO_BONUS } from "~/lib/mvp.constants";
import { muToRating } from "~/lib/skill";

// Mock auth
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

import { processGame } from "~/lib/elo.server";

type TeamSnapshot = { team: string; players: { name: string; order: number }[] };

const TEAMS: TeamSnapshot[] = [
  { team: "Ninjas", players: [{ name: "Alice", order: 0 }, { name: "Bob", order: 1 }] },
  { team: "Gunas", players: [{ name: "Charlie", order: 0 }, { name: "Dave", order: 1 }] },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedEvent(id: string, overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      id,
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
      teamsSnapshot: JSON.stringify(TEAMS),
      scoreOne: 3,
      scoreTwo: 1,
      ...overrides,
    },
  });
}

async function voteFor(historyId: string, votedForName: string, voterName: string, suffix: string) {
  await prisma.mvpVote.create({
    data: {
      gameHistoryId: historyId,
      voterPlayerId: `p-${suffix}`,
      voterName,
      votedForPlayerId: `target-${suffix}`,
      votedForName,
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
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ─── processGame with MVP rating bonus ───────────────────────────────────────

describe("processGame MVP rating bonus", () => {
  it("applies the bonus to the MVP when mvpEloEnabled is true", async () => {
    const event = await seedEvent("evt-bonus-on", { mvpEloEnabled: true, eloEnabled: true });
    const history = await seedHistory(event.id);
    // Alice and Charlie vote for Bob (a winner).
    await voteFor(history.id, "Bob", "Alice", "1");
    await voteFor(history.id, "Bob", "Charlie", "2");

    const updates = await processGame(event.id, history.id, TEAMS, 3, 1);

    const bobUpdate = updates.find((u) => u.name === "Bob")!;
    expect(bobUpdate).toBeDefined();
    expect(bobUpdate.delta).toBeGreaterThan(MVP_ELO_BONUS);
    expect(bobUpdate.newRating).toBe(bobUpdate.oldRating + bobUpdate.delta);

    const bobRating = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId: event.id, name: "Bob" } },
    });
    expect(bobRating).not.toBeNull();
    expect(bobRating!.rating).toBe(bobUpdate.newRating);
    // The persisted posterior still projects onto the stored scalar.
    expect(muToRating(bobRating!.ratingMu!)).toBeCloseTo(bobRating!.rating, 6);
  });

  it("adds exactly the bonus over an identical event with the bonus disabled", async () => {
    const withBonus = await seedEvent("evt-bonus-on-2", { mvpEloEnabled: true, eloEnabled: true });
    const withoutBonus = await seedEvent("evt-bonus-off", { mvpEloEnabled: false, eloEnabled: true });

    const historyOn = await seedHistory(withBonus.id);
    const historyOff = await seedHistory(withoutBonus.id);
    for (const history of [historyOn, historyOff]) {
      await voteFor(history.id, "Bob", "Alice", "a");
      await voteFor(history.id, "Bob", "Charlie", "b");
    }

    const onUpdates = await processGame(withBonus.id, historyOn.id, TEAMS, 3, 1);
    const offUpdates = await processGame(withoutBonus.id, historyOff.id, TEAMS, 3, 1);

    const bobOn = onUpdates.find((u) => u.name === "Bob")!;
    const bobOff = offUpdates.find((u) => u.name === "Bob")!;

    expect(bobOn.delta - bobOff.delta).toBeCloseTo(MVP_ELO_BONUS, 10);
    expect(bobOn.newRating - bobOff.newRating).toBeCloseTo(MVP_ELO_BONUS, 10);
  });

  it("applies the bonus to co-MVPs on a tie", async () => {
    const event = await seedEvent("evt-bonus-tie", { mvpEloEnabled: true, eloEnabled: true });
    const history = await seedHistory(event.id);
    // One vote for Bob, one for Alice — tie.
    await voteFor(history.id, "Bob", "Charlie", "c");
    await voteFor(history.id, "Alice", "Dave", "d");

    const updates = await processGame(event.id, history.id, TEAMS, 3, 1);

    const aliceUpdate = updates.find((u) => u.name === "Alice")!;
    const bobUpdate = updates.find((u) => u.name === "Bob")!;
    expect(aliceUpdate.delta).toBeGreaterThan(MVP_ELO_BONUS);
    expect(bobUpdate.delta).toBeGreaterThan(MVP_ELO_BONUS);

    const aliceRating = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId: event.id, name: "Alice" } },
    });
    const bobRating = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId: event.id, name: "Bob" } },
    });
    expect(aliceRating!.rating).toBe(aliceUpdate.newRating);
    expect(bobRating!.rating).toBe(bobUpdate.newRating);
  });

  it("does nothing when there are no MVP votes", async () => {
    const withBonus = await seedEvent("evt-novote-on", { mvpEloEnabled: true, eloEnabled: true });
    const withoutBonus = await seedEvent("evt-novote-off", { mvpEloEnabled: false, eloEnabled: true });
    const historyOn = await seedHistory(withBonus.id);
    const historyOff = await seedHistory(withoutBonus.id);

    const onUpdates = await processGame(withBonus.id, historyOn.id, TEAMS, 3, 1);
    const offUpdates = await processGame(withoutBonus.id, historyOff.id, TEAMS, 3, 1);

    for (const update of onUpdates) {
      const control = offUpdates.find((u) => u.name === update.name)!;
      expect(update.delta).toBeCloseTo(control.delta, 10);
      expect(update.newRating).toBeCloseTo(control.newRating, 10);
    }
  });
});
