import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server");
import { checkOwnership, getSession } from "~/lib/auth.helpers.server";

import { POST as priorityAddUser, DELETE as priorityRemoveUser } from "~/pages/api/events/[id]/priority/[userId]";
import { POST as priorityDecline } from "~/pages/api/events/[id]/priority/decline";
import { PUT as priorityOptIn } from "~/pages/api/events/[id]/priority/opt-in";
import { PUT as priorityOptOut } from "~/pages/api/events/[id]/priority/opt-out";
import { PUT as updateLocation } from "~/pages/api/events/[id]/location";
import { POST as testWebhook } from "~/pages/api/events/[id]/webhooks/[webhookId]/test";

function postCtx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

function putCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

function deleteCtx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });
  return { request, params } as any;
}

async function seedEvent(overrides: Record<string, any> = {}) {
  return prisma.event.create({
    data: {
      title: overrides.title ?? "Test Event",
      location: overrides.location ?? "Pitch A",
      dateTime: overrides.dateTime ?? new Date(Date.now() + 86400_000),
      teamOneName: "Team A",
      teamTwoName: "Team B",
      ...overrides,
    },
  });
}

let userCounter = 0;
async function seedUser(name = "Test User") {
  userCounter++;
  return prisma.user.create({
    data: { id: `user-cov2-${userCounter}-${Date.now()}`, name, email: `cov2-${userCounter}-${Date.now()}@test.com` },
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetApiRateLimitStore();
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.priorityConfirmation.deleteMany();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ─── Priority [userId] — POST (add enrollment) ──────────────────────────────

describe("POST /api/events/[id]/priority/[userId]", () => {
  it("returns 404 for non-existent event", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });
    const res = await priorityAddUser(postCtx({ id: "nonexistent", userId: "u1" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when not owner or admin", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false });
    const event = await seedEvent({ priorityEnabled: true });
    const res = await priorityAddUser(postCtx({ id: event.id, userId: "u1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when priority is not enabled", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });
    const event = await seedEvent({ priorityEnabled: false });
    const res = await priorityAddUser(postCtx({ id: event.id, userId: "u1" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when user does not exist", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });
    const event = await seedEvent({ priorityEnabled: true });
    const res = await priorityAddUser(postCtx({ id: event.id, userId: "nonexistent-user" }));
    expect(res.status).toBe(404);
  });

  it("successfully adds enrollment", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });
    const event = await seedEvent({ priorityEnabled: true });
    const user = await seedUser("Priority User");
    const res = await priorityAddUser(postCtx({ id: event.id, userId: user.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ─── Priority [userId] — DELETE (remove enrollment) ──────────────────────────

describe("DELETE /api/events/[id]/priority/[userId]", () => {
  it("returns 404 for non-existent event", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });
    const res = await priorityRemoveUser(deleteCtx({ id: "nonexistent", userId: "u1" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when not owner", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false });
    const event = await seedEvent();
    const res = await priorityRemoveUser(deleteCtx({ id: event.id, userId: "u1" }));
    expect(res.status).toBe(403);
  });

  it("successfully removes enrollment", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });
    const event = await seedEvent({ priorityEnabled: true });
    const user = await seedUser("Remove User");
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: user.id, source: "manual", optedIn: true },
    });
    const res = await priorityRemoveUser(deleteCtx({ id: event.id, userId: user.id }));
    expect(res.status).toBe(200);
  });
});

// ─── Priority decline ────────────────────────────────────────────────────────

describe("POST /api/events/[id]/priority/decline", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await priorityDecline(postCtx({ id: "e1" }));
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent event", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    const res = await priorityDecline(postCtx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when no pending confirmation exists", async () => {
    const user = await seedUser("Decline User");
    const event = await seedEvent();
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id } } as any);
    const res = await priorityDecline(postCtx({ id: event.id }));
    expect(res.status).toBe(404);
  });

  it("successfully declines a pending confirmation", async () => {
    const user = await seedUser("Decline OK");
    const event = await seedEvent();
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id } } as any);

    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: user.id, source: "auto", optedIn: true },
    });
    await prisma.priorityConfirmation.create({
      data: {
        eventId: event.id,
        userId: user.id,
        gameDate: event.dateTime,
        status: "pending",
        deadline: new Date(Date.now() + 86400_000),
        notifiedAt: new Date(),
      },
    });

    const res = await priorityDecline(postCtx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("declined");
  });
});

// ─── Priority opt-in ─────────────────────────────────────────────────────────

describe("PUT /api/events/[id]/priority/opt-in", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await priorityOptIn(putCtx({ id: "e1" }, {}));
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent event", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    const res = await priorityOptIn(putCtx({ id: "nonexistent" }, {}));
    expect(res.status).toBe(404);
  });

  it("returns 404 when not enrolled", async () => {
    const user = await seedUser("OptIn User");
    const event = await seedEvent();
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id } } as any);
    const res = await priorityOptIn(putCtx({ id: event.id }, {}));
    expect(res.status).toBe(404);
  });

  it("successfully opts in", async () => {
    const user = await seedUser("OptIn OK");
    const event = await seedEvent();
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id } } as any);
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: user.id, source: "auto", optedIn: false },
    });
    const res = await priorityOptIn(putCtx({ id: event.id }, {}));
    expect(res.status).toBe(200);
  });
});

// ─── Priority opt-out ────────────────────────────────────────────────────────

describe("PUT /api/events/[id]/priority/opt-out", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await priorityOptOut(putCtx({ id: "e1" }, {}));
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent event", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    const res = await priorityOptOut(putCtx({ id: "nonexistent" }, {}));
    expect(res.status).toBe(404);
  });

  it("returns 404 when not enrolled", async () => {
    const user = await seedUser("OptOut User");
    const event = await seedEvent();
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id } } as any);
    const res = await priorityOptOut(putCtx({ id: event.id }, {}));
    expect(res.status).toBe(404);
  });

  it("successfully opts out", async () => {
    const user = await seedUser("OptOut OK");
    const event = await seedEvent();
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id } } as any);
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: user.id, source: "auto", optedIn: true },
    });
    const res = await priorityOptOut(putCtx({ id: event.id }, {}));
    expect(res.status).toBe(200);
  });
});

// ─── PUT /api/events/[id]/location ───────────────────────────────────────────

describe("PUT /api/events/[id]/location", () => {
  it("returns 404 for non-existent event", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });
    const res = await updateLocation(putCtx({ id: "nonexistent" }, { location: "New Place" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when owned event and not owner", async () => {
    const user = await seedUser("Owner");
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false });
    const event = await seedEvent({ ownerId: user.id });
    const res = await updateLocation(putCtx({ id: event.id }, { location: "New Place" }));
    expect(res.status).toBe(403);
  });

  it("allows update on ownerless event even if not owner", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false });
    const event = await seedEvent({ ownerId: null });
    const res = await updateLocation(putCtx({ id: event.id }, { location: "New Place" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.location).toBe("New Place");
  });

  it("updates location with empty string", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });
    const event = await seedEvent();
    const res = await updateLocation(putCtx({ id: event.id }, { location: "" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.location).toBe("");
    expect(body.geocoded).toBe(false);
  });
});

// ─── POST /api/events/[id]/webhooks/[webhookId]/test ─────────────────────────

describe("POST /api/events/[id]/webhooks/[webhookId]/test", () => {
  it("returns 404 for non-existent webhook", async () => {
    const event = await seedEvent();
    const res = await testWebhook(postCtx({ id: event.id, webhookId: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("sends test webhook and records delivery (with mock fetch failure)", async () => {
    const event = await seedEvent();
    const webhook = await prisma.webhookSubscription.create({
      data: {
        eventId: event.id,
        url: "http://localhost:99999/webhook", // will fail to connect
        events: "test",
      },
    });

    const res = await testWebhook(postCtx({ id: event.id, webhookId: webhook.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivery).toBeTruthy();
    expect(body.delivery.eventType).toBe("test");
    expect(body.delivery.status).toBe("failed");
  });

  it("sends test webhook with secret and records delivery", async () => {
    const event = await seedEvent();
    const webhook = await prisma.webhookSubscription.create({
      data: {
        eventId: event.id,
        url: "http://localhost:99999/webhook",
        events: "test",
        secret: "my-secret",
      },
    });

    const res = await testWebhook(postCtx({ id: event.id, webhookId: webhook.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivery.status).toBe("failed"); // connection refused
  });
});
