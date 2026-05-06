import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET, POST } from "~/pages/api/events/[id]/webhooks";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/auth.helpers.server")>("~/lib/auth.helpers.server");
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

function getCtx(eventId: string) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/webhooks`, { method: "GET" }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/webhooks`),
  } as any;
}

function postCtx(eventId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/webhooks`),
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

describe("GET /api/events/[id]/webhooks", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await GET(getCtx("non-existent"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false });

    const res = await GET(getCtx(event.id));
    expect(res.status).toBe(403);
  });

  it("returns empty webhooks list", async () => {
    const owner = await seedUser("owner-2");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await GET(getCtx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhooks).toEqual([]);
  });

  it("returns webhooks for event", async () => {
    const owner = await seedUser("owner-3");
    const event = await seedEvent(owner.id);
    await prisma.webhookSubscription.create({
      data: { eventId: event.id, url: "https://example.com/hook" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await GET(getCtx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhooks).toHaveLength(1);
    expect(body.webhooks[0].url).toBe("https://example.com/hook");
  });
});

describe("POST /api/events/[id]/webhooks", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await POST(postCtx("non-existent", { url: "https://example.com" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false });

    const res = await POST(postCtx(event.id, { url: "https://example.com" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing url", async () => {
    const owner = await seedUser("owner-2");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await POST(postCtx(event.id, {}));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid url", async () => {
    const owner = await seedUser("owner-3");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await POST(postCtx(event.id, { url: "not-a-url" }));
    expect(res.status).toBe(400);
  });

  it("creates webhook for owner", async () => {
    const owner = await seedUser("owner-4");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await POST(postCtx(event.id, { url: "https://example.com/webhook", events: ["player_joined"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://example.com/webhook");
    expect(body.events).toEqual(["player_joined"]);
  });

  it("returns 409 for duplicate webhook url", async () => {
    const owner = await seedUser("owner-5");
    const event = await seedEvent(owner.id);
    await prisma.webhookSubscription.create({
      data: { eventId: event.id, url: "https://example.com/webhook" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await POST(postCtx(event.id, { url: "https://example.com/webhook" }));
    expect(res.status).toBe(409);
  });

  it("returns 429 when max webhooks reached", async () => {
    const owner = await seedUser("owner-6");
    const event = await seedEvent(owner.id);
    for (let i = 0; i < 10; i++) {
      await prisma.webhookSubscription.create({
        data: { eventId: event.id, url: `https://example.com/hook${i}` },
      });
    }

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await POST(postCtx(event.id, { url: "https://example.com/extra" }));
    expect(res.status).toBe(429);
  });

  it("filters invalid events", async () => {
    const owner = await seedUser("owner-7");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await POST(postCtx(event.id, { url: "https://example.com/webhook", events: ["player_joined", "invalid_event"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual(["player_joined"]);
  });

  it("allows admin to create webhook", async () => {
    const owner = await seedUser("owner-8");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: true });

    const res = await POST(postCtx(event.id, { url: "https://example.com/webhook" }));
    expect(res.status).toBe(200);
  });
});
