import { describe, it, expect, beforeEach, vi } from "vitest";
import type * as AuthHelpersServer from "~/lib/auth.helpers.server";
import { prisma } from "~/lib/db.server";
import { PATCH } from "~/pages/api/events/[id]/webhooks/[webhookId]";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof AuthHelpersServer>("~/lib/auth.helpers.server");
  return {
    ...actual,
    checkOwnership: vi.fn(),
  };
});

beforeEach(async () => {
  await prisma.webhookSubscription.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx(eventId: string, webhookId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/webhooks/${webhookId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: eventId, webhookId },
    url: new URL(`http://localhost/api/events/${eventId}/webhooks/${webhookId}`),
  } as any;
}

async function seedUser(id = "user-wh-1") {
  return prisma.user.create({
    data: { id, name: "Webhook User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(ownerId: string, id = "evt-wh-1") {
  return prisma.event.create({
    data: { id, title: "Webhook Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId },
  });
}

async function seedWebhook(eventId: string, url = "https://example.com/webhook", events: string[] = []) {
  return prisma.webhookSubscription.create({
    data: { eventId, url, events: JSON.stringify(events) },
  });
}

describe("PATCH /api/events/[id]/webhooks/[webhookId]", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await PATCH(ctx("non-existent", "wh-1", { events: ["player_joined"] }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEvent(owner.id);
    const webhook = await seedWebhook(event.id, "https://example.com/webhook", ["game_full"]);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const res = await PATCH(ctx(event.id, webhook.id, { events: ["player_joined"] }));
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent webhook", async () => {
    const owner = await seedUser("owner-2");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PATCH(ctx(event.id, "wh-nonexistent", { events: ["player_joined"] }));
    expect(res.status).toBe(404);
  });

  it("updates events for owner", async () => {
    const owner = await seedUser("owner-3");
    const event = await seedEvent(owner.id);
    const webhook = await seedWebhook(event.id, "https://example.com/webhook", ["game_full"]);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PATCH(ctx(event.id, webhook.id, { events: ["player_joined", "player_left"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual(["player_joined", "player_left"]);

    const updated = await prisma.webhookSubscription.findUnique({ where: { id: webhook.id } });
    expect(JSON.parse(updated!.events)).toEqual(["player_joined", "player_left"]);
  });

  it("returns 400 for missing events array", async () => {
    const owner = await seedUser("owner-4");
    const event = await seedEvent(owner.id);
    const webhook = await seedWebhook(event.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PATCH(ctx(event.id, webhook.id, {}));
    expect(res.status).toBe(400);
  });

  it("filters invalid events", async () => {
    const owner = await seedUser("owner-5");
    const event = await seedEvent(owner.id);
    const webhook = await seedWebhook(event.id, "https://example.com/webhook", ["game_full"]);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PATCH(ctx(event.id, webhook.id, { events: ["player_joined", "invalid_event"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual(["player_joined"]);
  });

  it("allows removing all events (subscribe to all)", async () => {
    const owner = await seedUser("owner-6");
    const event = await seedEvent(owner.id);
    const webhook = await seedWebhook(event.id, "https://example.com/webhook", ["game_full"]);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PATCH(ctx(event.id, webhook.id, { events: [] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
  });

  it("allows admin to update webhook", async () => {
    const owner = await seedUser("owner-7");
    const event = await seedEvent(owner.id);
    const webhook = await seedWebhook(event.id, "https://example.com/webhook", ["game_full"]);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: true, session: null } as any);

    const res = await PATCH(ctx(event.id, webhook.id, { events: ["game_reset"] }));
    expect(res.status).toBe(200);
  });

  it("allows ownerless event webhook update", async () => {
    const event = await prisma.event.create({
      data: { id: "evt-no-owner", title: "No Owner", location: "Pitch", dateTime: new Date(), maxPlayers: 10 },
    });
    const webhook = await seedWebhook(event.id, "https://example.com/webhook", ["game_full"]);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const res = await PATCH(ctx(event.id, webhook.id, { events: [] }));
    expect(res.status).toBe(200);
  });
});