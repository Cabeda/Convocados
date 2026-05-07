import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/events/[id]/webhooks/[webhookId]/deliveries";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

beforeEach(async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx(eventId: string, webhookId: string) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/webhooks/${webhookId}/deliveries`),
    params: { id: eventId, webhookId },
    url: new URL(`http://localhost/api/events/${eventId}/webhooks/${webhookId}/deliveries`),
  } as any;
}

describe("GET /api/events/[id]/webhooks/[webhookId]/deliveries", () => {
  it("returns 404 for non-existent webhook", async () => {
    const res = await GET(ctx("evt-1", "wh-1"));
    expect(res.status).toBe(404);
  });

  it("returns empty deliveries list", async () => {
    const event = await prisma.event.create({
      data: { id: "evt-1", title: "Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10 },
    });
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId: event.id, url: "https://example.com" },
    });
    const res = await GET(ctx(event.id, webhook.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliveries).toEqual([]);
  });

  it("returns deliveries with null dates", async () => {
    const event = await prisma.event.create({
      data: { id: "evt-2", title: "Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10 },
    });
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
    const event = await prisma.event.create({
      data: { id: "evt-3", title: "Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10 },
    });
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
