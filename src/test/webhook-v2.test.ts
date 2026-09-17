import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { checkWebhookHealth } from "~/lib/webhook.server";

// Helpers
const OWNER_ID = "webhook-v2-owner";
const OAUTH_CLIENT_ID = "webhook-v2-test-client";
const ACCESS_TOKEN = "tok-webhook-v2-owner";

function ctx(params: Record<string, string>, body?: unknown, opts: { auth?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth !== false) headers.authorization = `Bearer ${ACCESS_TOKEN}`;
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? "POST" : "GET",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

async function seedEvent(ownerId: string | null = OWNER_ID) {
  return (await prisma.event.create({
    data: {
      title: "Webhook V2 Test",
      location: "Pitch B",
      dateTime: new Date(Date.now() + 86400_000),
      teamOneName: "A",
      teamTwoName: "B",
      ownerId,
    },
  })).id;
}

async function seedAuth() {
  await prisma.user.create({
    data: { id: OWNER_ID, name: "Webhook V2 Owner", email: "webhook-v2-owner@test.com", emailVerified: true },
  });
  await prisma.oauthClient.create({
    data: { id: crypto.randomUUID(), clientId: OAUTH_CLIENT_ID, redirectUris: "", type: "web" },
  });
  await prisma.oauthAccessToken.create({
    data: {
      id: crypto.randomUUID(),
      token: ACCESS_TOKEN,
      clientId: OAUTH_CLIENT_ID,
      userId: OWNER_ID,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
}

async function seedWebhookWithDeliveries(eventId: string, failCount: number) {
  const webhook = await prisma.webhookSubscription.create({
    data: { eventId, url: "https://example.com/hook", events: "[]" },
  });
  for (let i = 0; i < failCount; i++) {
    await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventType: "player_joined",
        payload: "{}",
        status: "failed",
        attempts: 5,
        lastAttempt: new Date(),
        error: "HTTP 500",
      },
    });
  }
  return webhook;
}

beforeEach(async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.user.deleteMany();
  await seedAuth();
});

describe("GET /api/events/[id]/webhooks/[webhookId]/deliveries", () => {
  it("returns delivery logs for a webhook", async () => {
    const { GET } = await import("~/pages/api/events/[id]/webhooks/[webhookId]/deliveries");
    const eventId = await seedEvent();
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId, url: "https://example.com/hook", events: "[]" },
    });
    await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventType: "player_joined",
        payload: '{"test":true}',
        status: "success",
        attempts: 1,
        deliveredAt: new Date(),
      },
    });

    const res = await GET(ctx({ id: eventId, webhookId: webhook.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0].eventType).toBe("player_joined");
    expect(body.deliveries[0].status).toBe("success");
  });

  it("returns 404 for non-existent webhook", async () => {
    const { GET } = await import("~/pages/api/events/[id]/webhooks/[webhookId]/deliveries");
    const eventId = await seedEvent();
    const res = await GET(ctx({ id: eventId, webhookId: "nonexistent" }));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/events/[id]/webhooks/[webhookId]/test", () => {
  it("creates a test delivery record", { timeout: 15000 }, async () => {
    const { POST } = await import("~/pages/api/events/[id]/webhooks/[webhookId]/test");
    const eventId = await seedEvent();
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId, url: "https://httpbin.org/post", events: "[]" },
    });

    const res = await POST(ctx({ id: eventId, webhookId: webhook.id }, {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivery).toBeDefined();
    expect(body.delivery.eventType).toBe("test");
  });

  it("returns 404 for non-existent webhook", async () => {
    const { POST } = await import("~/pages/api/events/[id]/webhooks/[webhookId]/test");
    const eventId = await seedEvent();
    const res = await POST(ctx({ id: eventId, webhookId: "nonexistent" }, {}));
    expect(res.status).toBe(404);
  });

  it("rejects anonymous test delivery on an owned event", async () => {
    const { POST } = await import("~/pages/api/events/[id]/webhooks/[webhookId]/test");
    const eventId = await seedEvent();
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId, url: "https://example.com/hook", events: "[]" },
    });
    const res = await POST(ctx({ id: eventId, webhookId: webhook.id }, {}, { auth: false }));
    expect(res.status).toBe(403);
  });
});

describe("checkWebhookHealth", () => {
  it("disables webhook after consecutive failures", async () => {
    const eventId = await seedEvent();
    const webhook = await seedWebhookWithDeliveries(eventId, 10);

    await checkWebhookHealth(webhook.id);

    const updated = await prisma.webhookSubscription.findUnique({ where: { id: webhook.id } });
    expect(updated?.disabled).toBe(true);
  });

  it("does not disable webhook with fewer failures", async () => {
    const eventId = await seedEvent();
    const webhook = await seedWebhookWithDeliveries(eventId, 3);

    await checkWebhookHealth(webhook.id);

    const updated = await prisma.webhookSubscription.findUnique({ where: { id: webhook.id } });
    expect(updated?.disabled).toBeFalsy();
  });
});
