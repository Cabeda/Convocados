import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { authorizeEventMutation } from "~/lib/eventAuthz.server";

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

vi.mock("~/lib/autoConfirm.server", () => ({
  applyAutoConfirm: vi.fn().mockResolvedValue(undefined),
}));

import { PUT as cancelGame } from "~/pages/api/events/[id]/cancel";
import { PUT as updatePayment } from "~/pages/api/events/[id]/payments";
import { PUT as updateTitle } from "~/pages/api/events/[id]/title";
import { PUT as updateDateTime } from "~/pages/api/events/[id]/datetime";
import { DELETE as deleteHistory } from "~/pages/api/events/[id]/history/[historyId]";

/**
 * Issue #1732: an OAuth token scoped `read:events` must not be able to mutate
 * the Event just because its user owns it. The event-mutation seam reads the
 * token's scopes; a session caller keeps full access.
 */

let ownerId = "";
let readToken = "";
let fullToken = "";

async function seedUserWithToken(prefix: string, scopes: string) {
  const userId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.user.create({
    data: { id: userId, name: prefix, email: `${userId}@test.com`, emailVerified: false },
  });
  const clientId = `client-${userId}`;
  await prisma.oauthClient.create({
    data: { id: clientId, clientId, redirectUris: "https://example.com/callback" },
  });
  const token = await addToken(userId, clientId, scopes, prefix);
  return { userId, clientId, token };
}

async function addToken(userId: string, clientId: string, scopes: string, label: string) {
  const token = `tok-${label}-${userId}`;
  await prisma.oauthAccessToken.create({
    data: {
      id: `at-${label}-${userId}`,
      token,
      clientId,
      userId,
      scopes,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return token;
}

async function seedEvent() {
  const event = await prisma.event.create({
    data: {
      title: "Scoped Event",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId,
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  const eventCost = await prisma.eventCost.create({
    data: { eventId: event.id, totalAmount: 60, currency: "EUR" },
  });
  await prisma.playerPayment.create({
    data: { eventCostId: eventCost.id, playerName: "Ana", amount: 30, status: "pending" },
  });
  const history = await prisma.gameHistory.create({
    data: {
      eventId: event.id,
      dateTime: event.dateTime,
      status: "played",
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
    },
  });
  return { event, game, history };
}

function ctx(params: Record<string, string>, token?: string, body?: unknown, method = "PUT") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request("http://localhost/api/test", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as any;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  let ownerClientId = "";
  ({ userId: ownerId, clientId: ownerClientId, token: readToken } = await seedUserWithToken(
    "owner",
    "openid read:events",
  ));
  fullToken = await addToken(ownerId, ownerClientId, "openid read:events write:events", "builder");
});

describe("event mutation scope enforcement", () => {
  it("denies a read:events token at the seam and allows a full-scope token", async () => {
    const { event } = await seedEvent();

    const readOnly = await authorizeEventMutation(ctx({}, readToken).request, event);
    expect(readOnly).toMatchObject({ allowed: false, reason: "insufficient_scope" });

    const full = await authorizeEventMutation(ctx({}, fullToken).request, event);
    expect(full).toMatchObject({ allowed: true, role: "owner" });
  });

  it("refuses a read:events token on cancel, title, datetime, payments and history DELETE", async () => {
    const { event, game, history } = await seedEvent();

    const cancel = await cancelGame(ctx({ id: event.id }, readToken));
    expect(cancel.status).toBe(403);
    expect((await cancel.json()).error).toBe("insufficient_scope");
    expect((await prisma.game.findUniqueOrThrow({ where: { id: game.id } })).status).toBe("upcoming");

    const title = await updateTitle(ctx({ id: event.id }, readToken, { title: "Hacked" }));
    expect(title.status).toBe(403);
    expect((await title.json()).error).toBe("insufficient_scope");
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe("Scoped Event");

    const datetime = await updateDateTime(
      ctx({ id: event.id }, readToken, { dateTime: new Date(Date.now() + 172_800_000).toISOString() }),
    );
    expect(datetime.status).toBe(403);
    expect((await datetime.json()).error).toBe("insufficient_scope");

    const payments = await updatePayment(
      ctx({ id: event.id }, readToken, { playerName: "Ana", status: "paid" }),
    );
    expect(payments.status).toBe(403);
    expect((await payments.json()).error).toBe("insufficient_scope");
    const stillPending = await prisma.playerPayment.findFirstOrThrow({
      where: { playerName: "Ana" },
    });
    expect(stillPending.status).toBe("pending");

    const historyDelete = await deleteHistory(
      ctx({ id: event.id, historyId: history.id }, readToken, undefined, "DELETE"),
    );
    expect(historyDelete.status).toBe(403);
    expect((await historyDelete.json()).error).toBe("insufficient_scope");
    expect(await prisma.gameHistory.findUnique({ where: { id: history.id } })).not.toBeNull();
  });

  it("still allows the owner with full scopes to cancel and mark a payment paid", async () => {
    const { event, game } = await seedEvent();

    const cancel = await cancelGame(ctx({ id: event.id }, fullToken));
    expect(cancel.status).toBe(200);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: game.id } })).status).toBe("cancelled");

    const payments = await updatePayment(
      ctx({ id: event.id }, fullToken, { playerName: "Ana", status: "paid" }),
    );
    expect(payments.status).toBe(200);
    expect((await payments.json()).status).toBe("paid");
  });
});
