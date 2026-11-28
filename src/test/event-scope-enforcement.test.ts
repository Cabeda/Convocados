import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { authorizeEventMutation } from "~/lib/eventAuthz.server";
import { PUT as cancelGame } from "~/pages/api/events/[id]/cancel";
import { PUT as updatePayments } from "~/pages/api/events/[id]/payments";

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/scheduler.server", () => ({
  cancelEventJobs: vi.fn().mockResolvedValue(undefined),
  scheduleEventReminders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/priority.server", () => ({
  autoPriorityEnroll: vi.fn().mockResolvedValue(undefined),
}));

/**
 * A bearer token is scoped: authorizing a client for `openid read:events` must
 * not let it cancel a Game or move money. Session cookies carry `["*"]`, so
 * they keep full access. See src/lib/eventAuthz.server.ts.
 */

let ownerId = "";
let ownerToken = "";
let readToken = "";
let participantId = "";
let participantReadToken = "";

async function seedUser(prefix: string) {
  const userId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.user.create({
    data: { id: userId, name: prefix, email: `${userId}@test.com`, emailVerified: false },
  });
  return userId;
}

async function mintToken(userId: string, scopes: string) {
  const clientId = `client-${userId}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.oauthClient.create({
    data: { id: clientId, clientId, redirectUris: "https://example.com/callback" },
  });
  const token = `tok-${clientId}`;
  await prisma.oauthAccessToken.create({
    data: {
      id: `at-${clientId}`,
      token,
      clientId,
      userId,
      scopes,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return token;
}

async function seedEvent(owner: string) {
  return prisma.event.create({
    data: {
      title: "Scope Event",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      maxPlayers: 4,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId: owner,
      isPublic: false,
    },
  });
}

async function seedUpcomingGame(eventId: string) {
  const game = await prisma.game.create({
    data: { eventId, dateTime: new Date(Date.now() + 86_400_000), status: "upcoming" },
  });
  await prisma.event.update({ where: { id: eventId }, data: { currentGameId: game.id } });
  return game;
}

async function seedCost(eventId: string, linkedUserId?: string) {
  const cost = await prisma.eventCost.create({
    data: { eventId, totalAmount: 30, currency: "EUR" },
  });
  await prisma.playerPayment.create({
    data: { eventCostId: cost.id, playerName: "Ana", amount: 10, status: "pending" },
  });
  if (linkedUserId) {
    await prisma.player.create({
      data: { eventId, name: "Ana", userId: linkedUserId, order: 0 },
    });
  }
  return cost;
}

function putCtx(eventId: string, token: string, body?: unknown) {
  return {
    request: new Request("http://localhost/api/test", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    params: { id: eventId },
    url: new URL("http://localhost/api/test"),
  } as any;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.walletTransaction.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.playerInvite.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.event.deleteMany();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.user.deleteMany();

  ownerId = await seedUser("owner");
  ownerToken = await mintToken(ownerId, "write:events");
  readToken = await mintToken(ownerId, "openid read:events");
  participantId = await seedUser("participant");
  participantReadToken = await mintToken(participantId, "openid read:events");
});

describe("event mutation scope enforcement", () => {
  it("denies a read:events token at the seam even when its user owns the Event", async () => {
    const event = await seedEvent(ownerId);
    const authz = await authorizeEventMutation(putCtx(event.id, readToken).request as Request, event);
    expect(authz).toMatchObject({
      allowed: false,
      role: "forbidden",
      reason: "insufficient_scope",
    });
  });

  it("refuses to cancel a Game with a read:events token", async () => {
    const event = await seedEvent(ownerId);
    const game = await seedUpcomingGame(event.id);

    const res = await cancelGame(putCtx(event.id, readToken));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("insufficient_scope");
    expect((await prisma.game.findUniqueOrThrow({ where: { id: game.id } })).status).toBe("upcoming");
  });

  it("refuses a payments PUT with a read:events token, even for the Owner", async () => {
    const event = await seedEvent(ownerId);
    const cost = await seedCost(event.id);
    const res = await updatePayments(
      putCtx(event.id, readToken, { playerName: "Ana", status: "sent" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("insufficient_scope");
    expect(
      (await prisma.playerPayment.findUniqueOrThrow({
        where: { eventCostId_playerName: { eventCostId: cost.id, playerName: "Ana" } },
      })).status,
    ).toBe("pending");
  });

  it("refuses a linked participant's self-report with a read:events token", async () => {
    const event = await seedEvent(ownerId);
    const cost = await seedCost(event.id, participantId);
    const res = await updatePayments(
      putCtx(event.id, participantReadToken, { playerName: "Ana", status: "sent" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("insufficient_scope");
    expect(
      (await prisma.playerPayment.findUniqueOrThrow({
        where: { eventCostId_playerName: { eventCostId: cost.id, playerName: "Ana" } },
      })).status,
    ).toBe("pending");
  });

  it("still lets an Owner holding write:events cancel and mark a payment paid", async () => {
    const event = await seedEvent(ownerId);
    const game = await seedUpcomingGame(event.id);
    expect((await cancelGame(putCtx(event.id, ownerToken))).status).toBe(200);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: game.id } })).status).toBe("cancelled");

    const second = await seedEvent(ownerId);
    const cost = await seedCost(second.id);
    expect(
      (await updatePayments(putCtx(second.id, ownerToken, { playerName: "Ana", status: "paid" }))).status,
    ).toBe(200);
    expect(
      (await prisma.playerPayment.findUniqueOrThrow({
        where: { eventCostId_playerName: { eventCostId: cost.id, playerName: "Ana" } },
      })).status,
    ).toBe("paid");
  });
});
