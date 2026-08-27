/**
 * Regression test for #846: the watch must be able to start scoring for an event
 * that has no teams assigned. POST /api/watch/events no longer requires teams;
 * it creates a GameHistory row with default team names and a null teamsSnapshot
 * so the score can be tracked without teams (an empty-array snapshot would be
 * truthy and trip the ELO/processGame "needs teams" guards downstream).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(undefined),
}));

const mockGetSession = vi.fn().mockResolvedValue({
  user: { id: "owner-1", name: "Owner", email: "owner@test.com" },
});
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: false }),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
}));

const { POST } = await import("~/pages/api/watch/events");

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

function ctx(body: unknown) {
  const request = new Request("http://localhost/api/watch/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: {} } as any;
}

async function seedUser(id: string) {
  return prisma.user.upsert({
    where: { id },
    create: { id, name: "Owner", email: `${id}@test.com`, emailVerified: true },
    update: {},
  });
}

async function seedEventWithNoTeams(ownerId: string) {
  return prisma.event.create({
    data: {
      title: "No Teams Game",
      location: "Court",
      dateTime: new Date(Date.now() + 3600_000),
      maxPlayers: 4,
      teamOneName: "",
      teamTwoName: "",
      ownerId,
    },
  });
}

beforeEach(async () => {
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.gameParticipant.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  mockGetSession.mockResolvedValue({
    user: { id: "owner-1", name: "Owner", email: "owner@test.com" },
  });
});

describe("POST /api/watch/events without teams (#846)", () => {
  it("creates a history record with default team names and null snapshot", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEventWithNoTeams(owner.id);

    const res = await POST(ctx({ eventId: event.id }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.scoreOne).toBe(0);
    expect(body.scoreTwo).toBe(0);

    const history = await prisma.gameHistory.findUnique({ where: { id: body.id } });
    expect(history).not.toBeNull();
    expect(history!.eventId).toBe(event.id);
    expect(history!.teamOneName).toBe("Team 1");
    expect(history!.teamTwoName).toBe("Team 2");
    expect(history!.teamsSnapshot).toBeNull();
  });

  it("keeps teamsSnapshot null so downstream ELO guards skip empty teams", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEventWithNoTeams(owner.id);

    await POST(ctx({ eventId: event.id }));

    const history = await prisma.gameHistory.findFirst({
      where: { eventId: event.id, status: "played" },
    });
    expect(history!.teamsSnapshot).toBeNull();
  });

  it("is idempotent — a second POST returns the existing record", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEventWithNoTeams(owner.id);

    const first = await POST(ctx({ eventId: event.id }));
    const second = await POST(ctx({ eventId: event.id }));

    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.id).toBe(secondBody.id);
    expect(secondBody.created).toBe(false);

    const count = await prisma.gameHistory.count({ where: { eventId: event.id } });
    expect(count).toBe(1);
  });

  it("still snapshots the teams when teamResults ARE assigned", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEventWithNoTeams(owner.id);
    await prisma.event.update({
      where: { id: event.id },
      data: { teamOneName: "Red", teamTwoName: "Blue" },
    });
    await prisma.teamResult.createMany({
      data: [
        { name: "Red", eventId: event.id },
        { name: "Blue", eventId: event.id },
      ],
    });

    await POST(ctx({ eventId: event.id }));

    const history = await prisma.gameHistory.findFirst({ where: { eventId: event.id } });
    expect(history!.teamOneName).toBe("Red");
    expect(history!.teamsSnapshot).not.toBeNull();
    expect(history!.teamsSnapshot).toContain("Red");
  });
});
