import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

import { checkOwnership, getSession } from "~/lib/auth.helpers.server";
import { PATCH as patchHistory } from "~/pages/api/events/[id]/history/[historyId]";
import { GET as getStatus } from "~/pages/api/events/[id]/post-game-status";

const mockGetSession = vi.mocked(getSession);
const mockCheckOwnership = vi.mocked(checkOwnership);

const patchCtx = (params: Record<string, string>, body: unknown) =>
  ({ request: new Request("http://localhost/api/test", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params }) as any;
const getCtx = (params: Record<string, string>) => ({ request: new Request("http://localhost/api/test"), params, url: new URL("http://localhost/api/test") }) as any;

/** A one-off (or weekly) game whose kickoff is `agoMs` in the past, with its live Game still "upcoming" and no history row. */
async function seedEnded(opts: { recurring?: boolean; agoMs?: number } = {}) {
  await prisma.user.upsert({ where: { id: "owner1" }, create: { id: "owner1", name: "Owner", email: "owner1@test.com", emailVerified: true }, update: {} });
  const dateTime = new Date(Date.now() - (opts.agoMs ?? 3 * 3_600_000));
  const event = await prisma.event.create({
    data: { title: "One-off", location: "Pitch", dateTime, durationMinutes: 90, ownerId: "owner1", isRecurring: !!opts.recurring, teamOneName: "Ninjas", teamTwoName: "Gunas" },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime, status: "upcoming" } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  const a = await prisma.teamResult.create({ data: { name: "Ninjas", eventId: event.id } });
  await prisma.teamMember.create({ data: { name: "Alice", order: 0, teamResultId: a.id } });
  const b = await prisma.teamResult.create({ data: { name: "Gunas", eventId: event.id } });
  await prisma.teamMember.create({ data: { name: "Bob", order: 0, teamResultId: b.id } });
  return { event, game, dateTime };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetApiRateLimitStore();
  await resetRateLimitStore();
  for (const m of ["mvpVote", "gamePayment", "gameParticipant", "game", "eventPlayer", "playerPayment", "eventCost", "gameHistory", "teamMember", "teamResult", "player", "event", "user"] as const) {
    await (prisma[m] as any).deleteMany();
  }
  mockGetSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as any);
  mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: { id: "owner1", name: "Owner" } } } as any);
});

describe("an ended one-off with no history row: the score creates it", () => {
  it("post-game-status names the live game to save the score on, only while there is no history row", async () => {
    const { event, game } = await seedEnded();
    const before = await (await getStatus(getCtx({ id: event.id }))).json();
    expect(before.latestHistoryId).toBeNull();
    expect(before.pendingGameId).toBe(game.id);

    await patchHistory(patchCtx({ id: event.id, historyId: game.id }, { scoreOne: 3, scoreTwo: 1 }));
    const after = await (await getStatus(getCtx({ id: event.id }))).json();
    expect(after.pendingGameId).toBeNull();
    expect(after.latestHistoryId).not.toBeNull();
    expect(after.scoreOne).toBe(3);
  });

  it("counts somebody on the live game's roster as a player, so they may add the first score too", async () => {
    const { event, game } = await seedEnded();
    await prisma.user.create({ data: { id: "u-ana", name: "Ana Account", email: "ana@test.com", emailVerified: true } });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Ana Lopes", userId: "u-ana" } });
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ep.id, status: "active", order: 0 } });
    mockGetSession.mockResolvedValue({ user: { id: "u-ana", name: "Ana Account" } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);
    const status = await (await getStatus(getCtx({ id: event.id }))).json();
    expect(status.isPlayer).toBe(true);
    expect(status.pendingGameId).toBe(game.id);
    // A stranger is not.
    mockGetSession.mockResolvedValue({ user: { id: "u-zed", name: "Zed" } } as any);
    expect((await (await getStatus(getCtx({ id: event.id }))).json()).isPlayer).toBe(false);
  });

  it.each([
    ["linked to the ledger name", true],
    ["not linked to anyone", false],
  ])("a viewer whose account differs from the ledger name: status and the first-score save agree (%s)", async (_label, linked) => {
    const { event, game } = await seedEnded();
    // The lineup knows "Ana Lopes"; the account is "Ana Account".
    const ana = await prisma.teamResult.findFirstOrThrow({ where: { eventId: event.id, name: "Ninjas" } });
    await prisma.teamMember.create({ data: { name: "Ana Lopes", order: 1, teamResultId: ana.id } });
    await prisma.user.create({ data: { id: "u-ana", name: "Ana Account", email: "ana@test.com", emailVerified: true } });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Ana Lopes", userId: linked ? "u-ana" : null } });
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ep.id, status: "active", order: 0 } });
    mockGetSession.mockResolvedValue({ user: { id: "u-ana", name: "Ana Account" } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const status = await (await getStatus(getCtx({ id: event.id }))).json();
    const save = await patchHistory(patchCtx({ id: event.id, historyId: game.id }, { scoreOne: 2, scoreTwo: 1 }));
    expect({ isPlayer: status.isPlayer, saved: save.status === 200 }).toEqual({ isPlayer: linked, saved: linked });
    if (!linked) expect(save.status).toBe(403);
  });

  it("PATCH on the live game id creates the history row with the score and the teams", async () => {
    const { event, game, dateTime } = await seedEnded();
    const res = await patchHistory(patchCtx({ id: event.id, historyId: game.id }, { scoreOne: 3, scoreTwo: 1 }));
    expect(res.status).toBe(200);
    const rows = await prisma.gameHistory.findMany({ where: { eventId: event.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scoreOne: 3, scoreTwo: 1, status: "played" });
    expect(rows[0].dateTime.getTime()).toBe(dateTime.getTime());
    expect(rows[0].teamsSnapshot).toContain("Alice");
  });

  it("saving again edits the same row instead of creating a second one", async () => {
    const { event, game } = await seedEnded();
    await patchHistory(patchCtx({ id: event.id, historyId: game.id }, { scoreOne: 3, scoreTwo: 1 }));
    const res = await patchHistory(patchCtx({ id: event.id, historyId: game.id }, { scoreOne: 4, scoreTwo: 1 }));
    expect(res.status).toBe(200);
    const rows = await prisma.gameHistory.findMany({ where: { eventId: event.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].scoreOne).toBe(4);
  });

  it("a game that has not ended yet cannot be scored: nothing is created", async () => {
    const { event, game } = await seedEnded({ agoMs: -3_600_000 });
    const res = await patchHistory(patchCtx({ id: event.id, historyId: game.id }, { scoreOne: 1, scoreTwo: 0 }));
    expect(res.status).toBe(404);
    expect(await prisma.gameHistory.count({ where: { eventId: event.id } })).toBe(0);
    expect((await (await getStatus(getCtx({ id: event.id }))).json()).pendingGameId).toBeNull();
  });

  it("a weekly game is not touched: its history is made by the reset, not by a score", async () => {
    const { event, game } = await seedEnded({ recurring: true });
    const res = await patchHistory(patchCtx({ id: event.id, historyId: game.id }, { scoreOne: 1, scoreTwo: 0 }));
    expect(res.status).toBe(404);
    expect(await prisma.gameHistory.count({ where: { eventId: event.id } })).toBe(0);
    expect((await (await getStatus(getCtx({ id: event.id }))).json()).pendingGameId).toBeNull();
  });

  it("still needs a signed-in player, owner or admin", async () => {
    const { event, game } = await seedEnded();
    mockGetSession.mockResolvedValue(null);
    const res = await patchHistory(patchCtx({ id: event.id, historyId: game.id }, { scoreOne: 1, scoreTwo: 0 }));
    expect(res.status).toBe(401);
    expect(await prisma.gameHistory.count({ where: { eventId: event.id } })).toBe(0);
  });
});
