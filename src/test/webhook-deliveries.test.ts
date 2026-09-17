import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/events/[id]/webhooks/[webhookId]/deliveries";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const OWNER_ID = "deliveries-owner";
const OAUTH_CLIENT_ID = "deliveries-test-client";
const ACCESS_TOKEN = "tok-deliveries-owner";

beforeEach(async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();

  await prisma.user.create({
    data: { id: OWNER_ID, name: "Deliveries Owner", email: "deliveries-owner@test.com", emailVerified: true },
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
});

function ctx(eventId: string, webhookId: string, opts: { auth?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) headers.authorization = `Bearer ${ACCESS_TOKEN}`;
  return {
    request: new Request(`http://localhost/api/events/${eventId}/webhooks/${webhookId}/deliveries`, { headers }),
    params: { id: eventId, webhookId },
    url: new URL(`http://localhost/api/events/${eventId}/webhooks/${webhookId}/deliveries`),
  } as any;
}

async function seedOwnedEvent(id: string) {
  return prisma.event.create({
    data: { id, title: "Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId: OWNER_ID },
  });
}

describe("GET /api/events/[id]/webhooks/[webhookId]/deliveries", () => {
  it("returns 404 for non-existent webhook", async () => {
    const res = await GET(ctx("evt-1", "wh-1"));
    expect(res.status).toBe(404);
  });

  it("rejects anonymous access to deliveries on an owned event", async () => {
    const event = await seedOwnedEvent("evt-anon");
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId: event.id, url: "https://example.com" },
    });
    const res = await GET(ctx(event.id, webhook.id, { auth: false }));
    expect(res.status).toBe(403);
  });

  it("returns empty deliveries list", async () => {
    const event = await seedOwnedEvent("evt-1");
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId: event.id, url: "https://example.com" },
    });
    const res = await GET(ctx(event.id, webhook.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliveries).toEqual([]);
  });

  it("returns deliveries with null dates", async () => {
    const event = await seedOwnedEvent("evt-2");
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId: event.id, url: "https://example.com" },
    });
    await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventType: "player_joined",
        payload: "{}",
        status: "pending",
        attempts: 0,
      },
    });
    const res = await GET(ctx(event.id, webhook.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0].deliveredAt).toBeNull();
    expect(body.deliveries[0].lastAttempt).toBeNull();
  });

  it("returns deliveries with dates", async () => {
    const event = await seedOwnedEvent("evt-3");
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId: event.id, url: "https://example.com" },
    });
    const now = new Date();
    await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventType: "player_joined",
        payload: "{}",
        status: "delivered",
        attempts: 1,
        deliveredAt: now,
        lastAttempt: now,
      },
    });
    const res = await GET(ctx(event.id, webhook.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliveries[0].deliveredAt).toBe(now.toISOString());
    expect(body.deliveries[0].lastAttempt).toBe(now.toISOString());
  });
});
