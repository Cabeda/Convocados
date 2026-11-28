import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

import { GET } from "~/pages/api/events/[id]/history/index";

function getCtx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", { method: "GET" });
  return { request, params } as any;
}

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
        { team: "Gunas", players: [{ name: "Cara", order: 0 }, { name: "Dan", order: 1 }] },
      ]),
      ...overrides,
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  await resetApiRateLimitStore();
  await prisma.mvpVote.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.game.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("GET history list — batched MVP summaries", () => {
  it("attaches the MVP tally to each GameHistory entry", async () => {
    const event = await seedEvent();
    const alice = await prisma.player.create({ data: { name: "Alice", eventId: event.id } });
    const bob = await prisma.player.create({ data: { name: "Bob", eventId: event.id } });
    const history = await seedHistory(event.id);
    await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: alice.id,
        voterName: "Alice",
        votedForPlayerId: bob.id,
        votedForName: "Bob",
      },
    });

    const res = await GET(getCtx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].mvp).toBeTruthy();
    expect(body.data[0].mvp.totalVotes).toBe(1);
    expect(body.data[0].mvp.mvp[0]).toMatchObject({ playerId: bob.id, playerName: "Bob", voteCount: 1 });
    const bobParticipant = body.data[0].mvp.participants.find((p: { name: string }) => p.name === "Bob");
    expect(bobParticipant.voteCount).toBe(1);
  });

  it("marks hasVoted for a participant who voted", async () => {
    const event = await seedEvent();
    const user = await prisma.user.create({
      data: { id: "u-alice", name: "Alice", email: "alice@test.com", emailVerified: false },
    });
    const alice = await prisma.player.create({ data: { name: "Alice", eventId: event.id, userId: user.id } });
    const bob = await prisma.player.create({ data: { name: "Bob", eventId: event.id } });
    await prisma.eventPlayer.create({ data: { name: "Alice", eventId: event.id, userId: user.id } });
    const history = await seedHistory(event.id);
    await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: alice.id,
        voterName: "Alice",
        votedForPlayerId: bob.id,
        votedForName: "Bob",
      },
    });
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: "Alice", email: user.email } } as any);

    const res = await GET(getCtx({ id: event.id }));
    const body = await res.json();
    expect(body.data[0].mvp.hasVoted).toBe(true);
  });

  it("marks hasVoted for a linked EventPlayer with no Player row", async () => {
    const event = await seedEvent();
    const user = await prisma.user.create({
      data: { id: "u-zoey", name: "Zoey", email: "zoey@test.com", emailVerified: false },
    });
    await prisma.eventPlayer.create({ data: { name: "Alice", eventId: event.id, userId: user.id } });
    const history = await seedHistory(event.id);
    await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: "name:Alice",
        voterName: "Alice",
        votedForPlayerId: "name:Bob",
        votedForName: "Bob",
      },
    });
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: "Zoey", email: user.email } } as any);

    const res = await GET(getCtx({ id: event.id }));
    const body = await res.json();
    expect(body.data[0].mvp.hasVoted).toBe(true);
  });

  it("counts eligible voters by linked EventPlayer, not a self-editable User.name", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id);
    await prisma.user.create({
      data: { id: "u-alina", name: "Alina", email: "alina@test.com", emailVerified: false },
    });
    await prisma.user.create({
      data: { id: "u-bobby", name: "Bobby", email: "bobby@test.com", emailVerified: false },
    });
    await prisma.user.create({
      data: { id: "u-outsider", name: "Alice", email: "outsider@test.com", emailVerified: false },
    });
    await prisma.eventPlayer.create({ data: { name: "Alice", eventId: event.id, userId: "u-alina" } });
    await prisma.eventPlayer.create({ data: { name: "Bob", eventId: event.id, userId: "u-bobby" } });
    await prisma.eventPlayer.create({ data: { name: "Zoe", eventId: event.id, userId: "u-outsider" } });

    mockGetSession.mockResolvedValue({
      user: { id: "u-outsider", name: "Alice", email: "outsider@test.com" },
    } as any);

    const res = await GET(getCtx({ id: event.id }));
    const body = await res.json();
    expect(body.data[0].id).toBe(history.id);
    expect(body.data[0].mvp.eligibleVoters).toBe(2);
    // The outsider's User.name is "Alice" but its linked EventPlayer is not on
    // this roster, so it has no vote to recognize.
    expect(body.data[0].mvp.hasVoted).toBeNull();
  });

  it("uses the banner's eligible-voter count when a Game has no durable rows", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id);
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: history.dateTime, status: "played" },
    });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
    await prisma.user.create({
      data: { id: "u-alina", name: "Alina", email: "alina2@test.com", emailVerified: false },
    });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: "u-alina" } });

    const res = await GET(getCtx({ id: event.id }));
    const body = await res.json();
    // The banner's settledGameEligibleVoters also reports 0: a Game row with no
    // durable roster/payment rows is not bridged by the frozen snapshot.
    expect(body.data[0].mvp.eligibleVoters).toBe(0);
  });
});
