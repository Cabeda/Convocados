import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { resetViewerNamesCache } from "~/lib/postgame.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));
vi.mock("~/lib/eventLog.server", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

import { getSession, checkOwnership } from "~/lib/auth.helpers.server";
import { GET as getStatus } from "~/pages/api/events/[id]/post-game-status";
import { PATCH as patchHistory } from "~/pages/api/events/[id]/history/[historyId]";
import { POST as castVote } from "~/pages/api/events/[id]/history/[historyId]/mvp-vote";
import { POST as logGoal } from "~/pages/api/events/[id]/history/[historyId]/match-events";
import { DELETE as deleteGoal } from "~/pages/api/events/[id]/history/[historyId]/match-events/[matchEventId]";
import { GET as getMvp } from "~/pages/api/events/[id]/history/[historyId]/mvp";
import { GET as getHistoryList } from "~/pages/api/events/[id]/history/index";
import { POST as selfReport } from "~/pages/api/events/[id]/payments/settlement/self-report";

const mockGetSession = vi.mocked(getSession);
const mockCheckOwnership = vi.mocked(checkOwnership);

/**
 * The recap's status says who is a player; the endpoints behind its tasks decide who may act. They
 * must read the same identity, or the task is offered and the tap answers 403. The ledger calls the
 * viewer "Ana B"; the account is "anab99".
 */

const ACCOUNT = "anab99";
const LEDGER = "Ana B";

const ctx = (params: Record<string, string>, method = "GET", body?: unknown) => {
  const url = "http://localhost/api/test";
  return {
    request: new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
    params, url: new URL(url),
  } as any;
};

async function seedUser(id: string, name: string) {
  return prisma.user.create({ data: { id, name, email: `${id}@t.com`, emailVerified: false } });
}

async function seedGame() {
  await seedUser("owner-1", "Olga Owner");
  const event = await prisma.event.create({
    data: {
      title: "Recap", location: "Pitch", ownerId: "owner-1", isRecurring: true, mvpEnabled: true,
      dateTime: new Date(Date.now() + 5 * 86_400_000), durationMinutes: 30, teamOneName: "Foxes", teamTwoName: "Lions",
    },
  });
  const history = await prisma.gameHistory.create({
    data: {
      eventId: event.id, dateTime: new Date(Date.now() - 3600_000), status: "played", teamOneName: "Foxes", teamTwoName: "Lions",
      teamsSnapshot: JSON.stringify([
        { team: "Foxes", players: [{ name: LEDGER, order: 0 }, { name: "Bob", order: 1 }] },
        { team: "Lions", players: [{ name: "Charlie", order: 0 }, { name: "Dave", order: 1 }] },
      ]),
    },
  });
  return { eventId: event.id, historyId: history.id };
}

const linkPlayer = (eventId: string, userId: string, name = LEDGER) => prisma.player.create({ data: { eventId, name, userId } });
const linkEventPlayer = (eventId: string, userId: string, name = LEDGER) => prisma.eventPlayer.create({ data: { eventId, name, userId } });

function signIn(id: string, name: string) {
  mockGetSession.mockResolvedValue({ user: { id, name, email: `${id}@t.com` } } as any);
  mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false } as any);
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetViewerNamesCache();
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  for (const m of ["mvpVote", "gamePayment", "gameParticipant", "game", "eventPlayer", "playerPayment", "eventCost", "gameHistory", "teamResult", "player", "event", "user"] as const) {
    await (prisma[m] as any).deleteMany();
  }
});

interface Case {
  label: string;
  account: string;
  link?: (eventId: string, userId: string) => Promise<unknown>;
  allowed: boolean;
}

const CASES: Case[] = [
  { label: "the account name is on the lineup", account: "Bob", allowed: true },
  { label: "a roster Player row is linked to the account", account: ACCOUNT, link: (e, u) => linkPlayer(e, u), allowed: true },
  { label: "an EventPlayer row is linked to the account", account: ACCOUNT, link: (e, u) => linkEventPlayer(e, u), allowed: true },
  { label: "the lineup name is typed differently from the linked row", account: ACCOUNT, link: (e, u) => linkPlayer(e, u, "  ana b "), allowed: true },
  { label: "nothing is linked and the account name is not on the lineup", account: ACCOUNT, allowed: false },
  { label: "the lineup name is an unlinked Player row", account: ACCOUNT, link: (e) => prisma.player.create({ data: { eventId: e, name: LEDGER } }), allowed: false },
  {
    label: "the lineup name is linked to someone else",
    account: ACCOUNT,
    link: async (e) => { await seedUser("other", "Other"); await linkEventPlayer(e, "other"); },
    allowed: false,
  },
  { label: "the linked row is not on the lineup", account: ACCOUNT, link: (e, u) => linkPlayer(e, u, "Zed"), allowed: false },
];

describe("status and write endpoints agree on who the viewer is", () => {
  it.each(CASES)("$label → allowed: $allowed", async ({ account, link, allowed }) => {
    const { eventId, historyId } = await seedGame();
    await seedUser("viewer", account);
    await link?.(eventId, "viewer");
    signIn("viewer", account);

    const status = await (await getStatus(ctx({ id: eventId }))).json();
    expect({ isPlayer: status.isPlayer, isParticipant: status.isParticipant }).toEqual({ isPlayer: allowed, isParticipant: allowed });

    const score = await patchHistory(ctx({ id: eventId, historyId }, "PATCH", { scoreOne: 2, scoreTwo: 1 }));
    expect(score.status === 200).toBe(allowed);
    if (!allowed) expect(score.status).toBe(403);

    const vote = await castVote(ctx({ id: eventId, historyId }, "POST", { votedForName: "Dave" }));
    expect(vote.status === 200).toBe(allowed);
    if (!allowed) expect(vote.status).toBe(403);

    // Logging a goal writes the score too, so it reads the same identity.
    const goal = await logGoal(ctx({ id: eventId, historyId }, "POST", { type: "goal", team: "one", scorerName: "Bob" }));
    expect(goal.status === 201).toBe(allowed);
    if (!allowed) expect(goal.status).toBe(403);

    const made = await prisma.matchEvent.create({ data: { gameHistoryId: historyId, type: "goal", team: "one", scorerName: "Bob", createdById: "owner-1" } });
    const removed = await deleteGoal(ctx({ id: eventId, historyId, matchEventId: made.id }, "DELETE"));
    expect(removed.status === 200).toBe(allowed);
    if (!allowed) expect(removed.status).toBe(403);
  });
});

/**
 * An ended one-off has no history row until its first score, so who may save it is who is on the LIVE
 * roster: the status's `isPlayer` and the first-score PATCH read that same roster, whether or not the
 * player was drawn into a team.
 */
async function seedEndedOneOff() {
  await seedUser("owner-1", "Olga Owner");
  const dateTime = new Date(Date.now() - 3 * 3_600_000);
  const event = await prisma.event.create({
    data: { title: "One-off", location: "Pitch", ownerId: "owner-1", isRecurring: false, dateTime, durationMinutes: 60, teamOneName: "Foxes", teamTwoName: "Lions" },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime, status: "upcoming" } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  // Two drawn teams; neither includes the roster players below.
  const a = await prisma.teamResult.create({ data: { name: "Foxes", eventId: event.id } });
  await prisma.teamMember.create({ data: { name: "Bob", order: 0, teamResultId: a.id } });
  const b = await prisma.teamResult.create({ data: { name: "Lions", eventId: event.id } });
  await prisma.teamMember.create({ data: { name: "Charlie", order: 0, teamResultId: b.id } });
  return { eventId: event.id, gameId: game.id };
}

const onRoster = async (gameId: string, eventPlayerId: string, status = "active", archivedAt: Date | null = null) =>
  prisma.gameParticipant.create({ data: { gameId, eventPlayerId, order: 0, status, archivedAt } });

interface EndedCase {
  label: string;
  account: string;
  seat?: (eventId: string, gameId: string, userId: string) => Promise<unknown>;
  allowed: boolean;
}

const ENDED_CASES: EndedCase[] = [
  {
    label: "a linked roster player who was not drawn into a team",
    account: ACCOUNT,
    seat: async (e, g, u) => onRoster(g, (await linkEventPlayer(e, u)).id),
    allowed: true,
  },
  {
    label: "a roster player known only by the account name (nothing linked)",
    account: "Dina",
    seat: async (e, g) => onRoster(g, (await prisma.eventPlayer.create({ data: { eventId: e, name: "Dina" } })).id),
    allowed: true,
  },
  {
    label: "a roster seat whose name matches a linked Player row",
    account: ACCOUNT,
    seat: async (e, g, u) => {
      await linkPlayer(e, u);
      return onRoster(g, (await prisma.eventPlayer.create({ data: { eventId: e, name: LEDGER } })).id);
    },
    allowed: true,
  },
  {
    label: "a linked row that is not on the live roster",
    account: ACCOUNT,
    seat: async (e, _g, u) => { await linkEventPlayer(e, u); },
    allowed: false,
  },
  {
    label: "a roster seat that is someone else's and unlinked",
    account: ACCOUNT,
    seat: async (e, g) => onRoster(g, (await prisma.eventPlayer.create({ data: { eventId: e, name: "Zed" } })).id),
    allowed: false,
  },
  {
    label: "a pending invitation",
    account: ACCOUNT,
    seat: async (e, g, u) => onRoster(g, (await linkEventPlayer(e, u)).id, "pending"),
    allowed: false,
  },
  {
    label: "an archived roster seat",
    account: ACCOUNT,
    seat: async (e, g, u) => onRoster(g, (await linkEventPlayer(e, u)).id, "active", new Date()),
    allowed: false,
  },
  { label: "a stranger", account: "Stranger", allowed: false },
];

describe("an ended one-off: status and the first-score save agree on who the viewer is", () => {
  it.each(ENDED_CASES)("$label → allowed: $allowed", async ({ account, seat, allowed }) => {
    const { eventId, gameId } = await seedEndedOneOff();
    await seedUser("viewer", account);
    await seat?.(eventId, gameId, "viewer");
    signIn("viewer", account);

    const status = await (await getStatus(ctx({ id: eventId }))).json();
    expect(status.isPlayer).toBe(allowed);
    expect(status.pendingGameId).toBe(gameId);

    const save = await patchHistory(ctx({ id: eventId, historyId: gameId }, "PATCH", { scoreOne: 2, scoreTwo: 1 }));
    expect(save.status).toBe(allowed ? 200 : 403);
    expect(await prisma.gameHistory.count({ where: { eventId } })).toBe(allowed ? 1 : 0);
  });
});

describe("a ledger name that differs from the account name", () => {
  it("records the vote under the linked name and clears the viewer's MVP task", async () => {
    const { eventId, historyId } = await seedGame();
    await seedUser("viewer", ACCOUNT);
    await linkEventPlayer(eventId, "viewer");
    signIn("viewer", ACCOUNT);

    const before = await (await getStatus(ctx({ id: eventId }))).json();
    expect(before.myMvpComplete).toBe(false);

    const res = await castVote(ctx({ id: eventId, historyId }, "POST", { votedForName: "Charlie" }));
    expect(res.status).toBe(200);
    expect(await prisma.mvpVote.findFirst({ where: { gameHistoryId: historyId } })).toMatchObject({ voterName: LEDGER, votedForName: "Charlie" });

    const after = await (await getStatus(ctx({ id: eventId }))).json();
    expect(after.myMvpComplete).toBe(true);
    expect((await (await getMvp(ctx({ id: eventId, historyId }))).json()).hasVoted).toBe(true);
  });

  it("reports hasVoted on the history list under the linked name", async () => {
    const { eventId, historyId } = await seedGame();
    await seedUser("viewer", ACCOUNT);
    await linkPlayer(eventId, "viewer");
    signIn("viewer", ACCOUNT);

    const read = async () => {
      const json = await (await getHistoryList(ctx({ id: eventId }))).json();
      return json.data.find((h: { id: string }) => h.id === historyId).mvp.hasVoted;
    };
    expect(await read()).toBe(false);
    expect((await castVote(ctx({ id: eventId, historyId }, "POST", { votedForName: "Charlie" }))).status).toBe(200);
    expect(await read()).toBe(true);
  });

  it.each([
    ["by name", { votedForName: LEDGER }],
    ["by name, differently typed", { votedForName: "ANA B" }],
  ])("still refuses a vote for yourself (%s)", async (_label, body) => {
    const { eventId, historyId } = await seedGame();
    await seedUser("viewer", ACCOUNT);
    await linkEventPlayer(eventId, "viewer");
    signIn("viewer", ACCOUNT);
    const res = await castVote(ctx({ id: eventId, historyId }, "POST", body));
    expect(res.status).toBe(400);
    expect(await prisma.mvpVote.count()).toBe(0);
  });

  it("still refuses a vote for yourself by the id of your linked row, and for any other name you are linked to", async () => {
    const { eventId, historyId } = await seedGame();
    await seedUser("viewer", ACCOUNT);
    const mine = await linkPlayer(eventId, "viewer");
    await linkEventPlayer(eventId, "viewer", "Charlie");
    signIn("viewer", ACCOUNT);

    expect((await castVote(ctx({ id: eventId, historyId }, "POST", { votedForPlayerId: mine.id }))).status).toBe(400);
    expect((await castVote(ctx({ id: eventId, historyId }, "POST", { votedForName: "Charlie" }))).status).toBe(400);
    expect((await castVote(ctx({ id: eventId, historyId }, "POST", { votedForName: "Dave" }))).status).toBe(200);
  });

  it("never takes a name from the client: voting as someone else's name is refused", async () => {
    const { eventId, historyId } = await seedGame();
    await seedUser("viewer", ACCOUNT);
    signIn("viewer", ACCOUNT);
    const res = await castVote(ctx({ id: eventId, historyId }, "POST", { votedForName: "Dave", voterName: "Bob", voterPlayerId: "name:Bob" }));
    expect(res.status).toBe(403);
    expect(await prisma.mvpVote.count()).toBe(0);
  });

  it("counts a linked roster name as an eligible voter, once", async () => {
    const { eventId, historyId } = await seedGame();
    await seedUser("viewer", ACCOUNT);
    await linkEventPlayer(eventId, "viewer");
    await seedUser("bob", "Bob");
    await seedUser("bob-2", "Bob"); // two accounts with one name are still one roster seat
    signIn("viewer", ACCOUNT);

    const mvp = await (await getMvp(ctx({ id: eventId, historyId }))).json();
    expect(mvp.eligibleVoters).toBe(2); // Ana B (linked) + Bob (by name)
    const list = await (await getHistoryList(ctx({ id: eventId }))).json();
    expect(list.data.find((h: { id: string }) => h.id === historyId).mvp.eligibleVoters).toBe(2);
  });

  it("holds the wrap-up open until every eligible voter, linked ones included, has voted", async () => {
    const { eventId, historyId } = await seedGame();
    await seedUser("viewer", ACCOUNT);
    await linkPlayer(eventId, "viewer");
    await seedUser("bob", "Bob");
    signIn("viewer", ACCOUNT);
    await castVote(ctx({ id: eventId, historyId }, "POST", { votedForName: "Charlie" }));

    // Bob has not voted yet: 1 vote of 2 eligible voters. Without the linked name this read 1 of 1.
    expect((await (await getStatus(ctx({ id: eventId }))).json()).mvpComplete).toBe(false);
  });

  it("lets the linked account report its own share and nobody else's", async () => {
    const { eventId } = await seedGame();
    await seedUser("viewer", ACCOUNT);
    const mine = await linkEventPlayer(eventId, "viewer");
    const theirs = await prisma.eventPlayer.create({ data: { eventId, name: "Bob" } });
    const game = await prisma.game.create({ data: { eventId, dateTime: new Date(Date.now() - 3600_000), status: "played" } });
    for (const ep of [mine, theirs]) {
      await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ep.id, order: 0, status: "active" } });
      await prisma.gamePayment.create({ data: { gameId: game.id, eventPlayerId: ep.id, playerName: ep.name, amount: 5, status: "pending" } });
    }
    signIn("viewer", ACCOUNT);

    expect((await selfReport(ctx({ id: eventId }, "POST", { gameId: game.id, eventPlayerId: theirs.id }))).status).toBe(403);
    expect((await selfReport(ctx({ id: eventId }, "POST", { gameId: game.id, eventPlayerId: mine.id }))).status).toBe(200);
  });
});
