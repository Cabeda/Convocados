import { describe, it, expect, beforeEach, vi } from "vitest";
import type * as AuthHelpersServer from "~/lib/auth.helpers.server";
import { prisma } from "~/lib/db.server";
import { DELETE } from "~/pages/api/events/[id]/webhooks/[webhookId]";
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

function ctx(eventId: string, webhookId: string) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/webhooks/${webhookId}`, {
      method: "DELETE",
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

describe("DELETE /api/events/[id]/webhooks/[webhookId]", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await DELETE(ctx("non-existent", "wh-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const res = await DELETE(ctx(event.id, "wh-1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent webhook", async () => {
    const owner = await seedUser("owner-2");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await DELETE(ctx(event.id, "wh-nonexistent"));
    expect(res.status).toBe(404);
  });

  it("deletes webhook for owner", async () => {
    const owner = await seedUser("owner-3");
    const event = await seedEvent(owner.id);
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId: event.id, url: "https://example.com/webhook" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await DELETE(ctx(event.id, webhook.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const remaining = await prisma.webhookSubscription.findUnique({ where: { id: webhook.id } });
    expect(remaining).toBeNull();
  });

  it("allows admin to delete webhook", async () => {
    const owner = await seedUser("owner-4");
    const event = await seedEvent(owner.id);
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId: event.id, url: "https://example.com/webhook" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: true, session: null } as any);

    const res = await DELETE(ctx(event.id, webhook.id));
    expect(res.status).toBe(200);
  });

  it("allows ownerless event webhook deletion", async () => {
    const event = await prisma.event.create({
      data: { id: "evt-no-owner", title: "No Owner", location: "Pitch", dateTime: new Date(), maxPlayers: 10 },
    });
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId: event.id, url: "https://example.com/webhook" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const res = await DELETE(ctx(event.id, webhook.id));
    expect(res.status).toBe(200);
  });
});
