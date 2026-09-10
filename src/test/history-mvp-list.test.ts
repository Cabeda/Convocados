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
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
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
});
