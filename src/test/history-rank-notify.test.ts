/**
 * Score-save path must push each account-linked player who played a counted
 * Game their Season Rank movement, deep-linking to the explainer URL.
 * See ADR 0031 and src/lib/seasonRankNotify.server.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

vi.mock("~/lib/eventLog.server", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/push.server", () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH as patchHistory } from "~/pages/api/events/[id]/history/[historyId]";
import { checkOwnership, getSession } from "~/lib/auth.helpers.server";
import { sendPushToUser } from "~/lib/push.server";
import { getViewerGameRank } from "~/lib/seasonRank.server";
import { notifySeasonRankChanges } from "~/lib/seasonRankNotify.server";
import { buildRankExplainerHref } from "~/lib/rankExplainer";
import { TIER_NAMES } from "~/lib/seasonRank";

const mockPush = vi.mocked(sendPushToUser);

function patchCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

interface SeedResult {
  eventId: string;
  seasonId: string;
  targetId: string;
  targetDateTime: Date;
  targetSnapshot: string;
  userAId: string;
  userBId: string;
}

async function seed(opts: { priorGames?: number; targetFriendly?: boolean; targetScored?: boolean; prefsA?: { pushEnabled: boolean }; localeA?: string } = {}) {
  const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@test" } });
  const userA = await prisma.user.create({ data: { id: "u-A", name: "A", email: "a@test" } });
  const userB = await prisma.user.create({ data: { id: "u-B", name: "B", email: "b@test" } });

  const event = await prisma.event.create({
    data: {
      title: "Rank Event",
      location: "Pitch",
      dateTime: new Date("2026-01-01T00:00:00Z"),
      maxPlayers: 10,
      ownerId: owner.id,
      eloEnabled: true,
      rankEnabled: true,
    },
  });

  // Established Skill Ratings so calibration has something to anchor/derive from.
  await prisma.playerRating.create({ data: { eventId: event.id, name: "A", rating: 1000, gamesPlayed: 5 } });
  await prisma.playerRating.create({ data: { eventId: event.id, name: "B", rating: 1100, gamesPlayed: 5 } });

  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: "S1",
      registrationOpensAt: new Date("2026-01-01T00:00:00Z"),
      registrationClosesAt: new Date("2026-02-01T00:00:00Z"),
      status: "active",
    },
  });

  for (const [user, name] of [[userA, "A"], [userB, "B"]] as const) {
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name, userId: user.id } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: ep.id, userId: user.id, status: "active" } });
  }

  const snapshot = JSON.stringify([
    { team: "T1", players: [{ name: "A", order: 0 }] },
    { team: "T2", players: [{ name: "B", order: 0 }] },
  ]);

  for (let i = 0; i < (opts.priorGames ?? 0); i++) {
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(`2026-01-0${2 + i}T00:00:00Z`),
        status: "played",
        isFriendly: false,
        scoreOne: 1,
        scoreTwo: 0,
        teamOneName: "T1",
        teamTwoName: "T2",
        teamsSnapshot: snapshot,
      },
    });
  }

  const targetDateTime = new Date(`2026-01-0${2 + (opts.priorGames ?? 0)}T00:00:00Z`);
  const target = await prisma.gameHistory.create({
    data: {
      eventId: event.id,
      dateTime: targetDateTime,
      status: "played",
      isFriendly: opts.targetFriendly ?? false,
      scoreOne: opts.targetScored ? 1 : null,
      scoreTwo: opts.targetScored ? 0 : null,
      teamOneName: "T1",
      teamTwoName: "T2",
      teamsSnapshot: snapshot,
    },
  });

  if (opts.prefsA) {
    await prisma.notificationPreferences.create({
      data: { userId: userA.id, pushEnabled: opts.prefsA.pushEnabled },
    });
  }
  if (opts.localeA) {
    await prisma.appPushToken.create({
      data: { userId: userA.id, token: `tok-${userA.id}`, platform: "android", locale: opts.localeA },
    });
  }

  return {
    eventId: event.id,
    seasonId: season.id,
    targetId: target.id,
    targetDateTime,
    targetSnapshot: snapshot,
    userAId: userA.id,
    userBId: userB.id,
  } satisfies SeedResult;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  vi.clearAllMocks();
  await prisma.seasonRankSnapshot.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.season.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.appPushToken.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  vi.mocked(getSession).mockResolvedValue({ user: { id: "u-owner", name: "Owner" } } as any);
  vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: { id: "u-owner", name: "Owner" } } } as any);
});

function pushCallFor(userId: string) {
  return mockPush.mock.calls.find((call) => call[0] === userId);
}

function countedGame(seedResult: SeedResult) {
  return {
    dateTime: seedResult.targetDateTime,
    status: "played",
    isFriendly: false,
    scoreOne: 1,
    scoreTwo: 0,
    teamsSnapshot: seedResult.targetSnapshot,
  };
}

describe("PATCH /api/events/[id]/history/[historyId] — Season Rank push", () => {
  it("sends one personalized push per account-linked player who played, with the explainer URL", async () => {
    const seedResult = await seed({ priorGames: 2, localeA: "pt" });

    const res = await patchHistory(
      patchCtx({ id: seedResult.eventId, historyId: seedResult.targetId }, { scoreOne: 1, scoreTwo: 0 }),
    );
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));

    const gameShape = {
      dateTime: seedResult.targetDateTime,
      status: "played",
      isFriendly: false,
      scoreOne: 1,
      scoreTwo: 0,
      teamsSnapshot: seedResult.targetSnapshot,
    };

    const rankA = await getViewerGameRank(seedResult.eventId, gameShape, "A");
    const rankB = await getViewerGameRank(seedResult.eventId, gameShape, "B");
    expect(rankA).not.toBeNull();
    expect(rankB).not.toBeNull();
    expect(rankA!.provisional).toBe(false);
    expect(rankA!.delta).toBeGreaterThan(0);
    expect(rankB!.delta).toBeLessThan(0);

    const callA = pushCallFor(seedResult.userAId)!;
    const callB = pushCallFor(seedResult.userBId)!;

    const expectedUrlA = buildRankExplainerHref(seedResult.eventId, {
      seasonId: rankA!.seasonId,
      rank: rankA!.after,
      delta: rankA!.delta,
      outcome: 1,
    });
    expect(callA[3]).toBe(expectedUrlA);
    expect(callA[3]).toContain(`seasonId=${seedResult.seasonId}`);
    expect(callA[3]).toContain(`rank=${rankA!.after}`);
    expect(callA[3]).toContain(`delta=${rankA!.delta}`);
    expect(callA[3]).toContain("outcome=1");

    expect(callB[3]).toBe(
      buildRankExplainerHref(seedResult.eventId, {
        seasonId: rankB!.seasonId,
        rank: rankB!.after,
        delta: rankB!.delta,
        outcome: 1,
      }),
    );

    // Per-recipient locale: A uses pt, B has no push locale so falls back to en.
    expect(callA[1]).toBe("Classificação da Época atualizada");
    expect(callA[2]).toBe(`+${rankA!.delta} RP → ${rankA!.after} (${TIER_NAMES[rankA!.tierAfter]})`);
    expect(callB[1]).toBe("Season Rank updated");
    expect(callB[2]).toBe(`${rankB!.delta} RP → ${rankB!.after} (${TIER_NAMES[rankB!.tierAfter]})`);
  });

  it("does not push when the game is friendly (non-counting)", async () => {
    const seedResult = await seed({ priorGames: 2, targetFriendly: true });

    const res = await patchHistory(
      patchCtx({ id: seedResult.eventId, historyId: seedResult.targetId }, { scoreOne: 1, scoreTwo: 0 }),
    );
    expect(res.status).toBe(200);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("respects global push preferences", async () => {
    const seedResult = await seed({ priorGames: 2, prefsA: { pushEnabled: false } });

    const res = await patchHistory(
      patchCtx({ id: seedResult.eventId, historyId: seedResult.targetId }, { scoreOne: 1, scoreTwo: 0 }),
    );
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(pushCallFor(seedResult.userAId)).toBeUndefined();
    expect(pushCallFor(seedResult.userBId)).toBeDefined();
  });

  it("does not push twice when a score is re-saved", async () => {
    const seedResult = await seed({ priorGames: 2 });

    await patchHistory(patchCtx({ id: seedResult.eventId, historyId: seedResult.targetId }, { scoreOne: 1, scoreTwo: 0 }));
    await vi.waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));

    mockPush.mockClear();
    const res = await patchHistory(
      patchCtx({ id: seedResult.eventId, historyId: seedResult.targetId }, { scoreOne: 2, scoreTwo: 0 }),
    );
    expect(res.status).toBe(200);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("notifySeasonRankChanges (direct)", () => {
  it("uses the provisional unlock message before the viewer has 3 games", async () => {
    const seedResult = await seed({ priorGames: 0, targetScored: true });

    await notifySeasonRankChanges(seedResult.eventId, countedGame(seedResult));

    expect(mockPush).toHaveBeenCalledTimes(2);
    const callA = pushCallFor(seedResult.userAId)!;
    expect(callA[2]).toContain("unlocks at 3 games (1/3)");
  });

  it("skips a player who muted post-game for the event", async () => {
    const seedResult = await seed({ priorGames: 2 });
    await prisma.eventFollow.create({
      data: { eventId: seedResult.eventId, userId: seedResult.userAId, mutePostGame: true },
    });

    await notifySeasonRankChanges(seedResult.eventId, countedGame(seedResult));

    expect(pushCallFor(seedResult.userAId)).toBeUndefined();
    expect(pushCallFor(seedResult.userBId)).toBeDefined();
  });

  it("honours the event admin post-game default", async () => {
    const seedResult = await seed({ priorGames: 2 });
    await prisma.event.update({
      where: { id: seedResult.eventId },
      data: { notificationDefaults: JSON.stringify({ mutePostGame: true }) },
    });

    await notifySeasonRankChanges(seedResult.eventId, countedGame(seedResult));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("no-ops on a malformed teamsSnapshot", async () => {
    const seedResult = await seed({ priorGames: 2 });

    await notifySeasonRankChanges(seedResult.eventId, { ...countedGame(seedResult), teamsSnapshot: "{not-json" });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("no-ops when no player in the snapshot is account-linked", async () => {
    const seedResult = await seed({ priorGames: 2 });
    const snapshot = JSON.stringify([
      { team: "T1", players: [{ name: "Ghost", order: 0 }] },
      { team: "T2", players: [{ name: "Nobody", order: 0 }] },
    ]);

    await notifySeasonRankChanges(seedResult.eventId, { ...countedGame(seedResult), teamsSnapshot: snapshot });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("swallows a per-player push failure and continues", async () => {
    const seedResult = await seed({ priorGames: 2, targetScored: true });
    mockPush.mockRejectedValueOnce(new Error("push down"));

    await notifySeasonRankChanges(seedResult.eventId, countedGame(seedResult));

    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it("swallows an unexpected failure before dispatch", async () => {
    const seedResult = await seed({ priorGames: 2 });
    const spy = vi.spyOn(prisma.eventPlayer, "findMany").mockRejectedValueOnce(new Error("db down"));

    await expect(notifySeasonRankChanges(seedResult.eventId, countedGame(seedResult))).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
