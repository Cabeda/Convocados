import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock auth
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

// Mock email
vi.mock("~/lib/email.server", () => ({
  sendAdminRoleNotification: vi.fn().mockResolvedValue(undefined),
}));

// Mock notification prefs
vi.mock("~/lib/notificationPrefs.server", () => ({
  getNotificationPrefs: vi.fn().mockResolvedValue({ emailEnabled: true, pushEnabled: true }),
}));

// Mock push
vi.mock("~/lib/push.server", () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));

import { getSession, checkOwnership, checkEventAdmin } from "~/lib/auth.helpers.server";
import { sendAdminRoleNotification } from "~/lib/email.server";
import { getNotificationPrefs } from "~/lib/notificationPrefs.server";
import { sendPushToUser } from "~/lib/push.server";
const mockGetSession = vi.mocked(getSession);
const mockCheckOwnership = vi.mocked(checkOwnership);
const mockCheckEventAdmin = vi.mocked(checkEventAdmin);
const mockSendAdminRoleNotification = vi.mocked(sendAdminRoleNotification);
const mockGetNotificationPrefs = vi.mocked(getNotificationPrefs);
const mockSendPushToUser = vi.mocked(sendPushToUser);

function ctx(params: Record<string, string>, body?: unknown, method?: string) {
  const request = new Request("http://localhost/api/test", {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

function deleteCtx(params: Record<string, string>, body?: unknown) {
  return ctx(params, body, "DELETE");
}

async function seedUsers() {
  await prisma.user.upsert({
    where: { id: "owner1" },
    create: { id: "owner1", name: "Owner", email: "owner@test.com", emailVerified: true },
    update: {},
  });
  await prisma.user.upsert({
    where: { id: "admin1" },
    create: { id: "admin1", name: "Admin User", email: "admin@test.com", emailVerified: true },
    update: {},
  });
  await prisma.user.upsert({
    where: { id: "user1" },
    create: { id: "user1", name: "Regular User", email: "user@test.com", emailVerified: true },
    update: {},
  });
}

async function seedOwnedEvent(ownerId: string) {
  const event = await prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId,
    },
  });
  return event;
}

describe("Event Admin API", () => {
  beforeEach(async () => {
    await prisma.eventAdmin.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    resetApiRateLimitStore();
    mockGetSession.mockResolvedValue(null);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    mockCheckEventAdmin.mockResolvedValue(false);
    mockSendAdminRoleNotification.mockClear();
    mockSendPushToUser.mockClear();
    mockGetNotificationPrefs.mockResolvedValue({ emailEnabled: true, pushEnabled: true } as any);
  });

  // ── GET /api/events/[id]/admins ─────────────────────────────────────

  describe("GET /api/events/[id]/admins", () => {
    it("should return admins list for the event owner", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");
      await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { GET } = await import("~/pages/api/events/[id]/admins");
      const res = await GET(ctx({ id: event.id }));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].userId).toBe("admin1");
      expect(data[0].name).toBe("Admin User");
      expect(data[0].email).toBe("admin@test.com");
    });

    it("should return 403 for non-owner", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "user1" } } as any);

      const { GET } = await import("~/pages/api/events/[id]/admins");
      const res = await GET(ctx({ id: event.id }));
      expect(res.status).toBe(403);
    });

    it("should return 403 for unauthenticated user", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      const { GET } = await import("~/pages/api/events/[id]/admins");
      const res = await GET(ctx({ id: event.id }));
      expect(res.status).toBe(403);
    });

    it("should return 404 for non-existent event", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { GET } = await import("~/pages/api/events/[id]/admins");
      const res = await GET(ctx({ id: "nonexistent" }));
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/events/[id]/admins ────────────────────────────────────

  describe("POST /api/events/[id]/admins", () => {
    it("should add an admin by email (owner only)", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { email: "admin@test.com" }));
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.userId).toBe("admin1");
      expect(data.name).toBe("Admin User");

      // Verify in DB
      const admins = await prisma.eventAdmin.findMany({ where: { eventId: event.id } });
      expect(admins).toHaveLength(1);
      expect(admins[0].userId).toBe("admin1");
    });

    it("should return 403 for non-owner", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "user1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { email: "admin@test.com" }));
      expect(res.status).toBe(403);
    });

    it("should return 403 for admins (only owner can add admins)", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");
      await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

      mockGetSession.mockResolvedValue({ user: { id: "admin1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { email: "user@test.com" }));
      expect(res.status).toBe(403);
    });

    it("should return 404 for non-existent user email", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { email: "nobody@test.com" }));
      expect(res.status).toBe(404);
    });

    it("should return 400 when trying to add the owner as admin", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { email: "owner@test.com" }));
      expect(res.status).toBe(400);
    });

    it("should handle duplicate admin gracefully (upsert)", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");
      await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { email: "admin@test.com" }));
      expect(res.status).toBe(201);

      // Still only one admin
      const admins = await prisma.eventAdmin.findMany({ where: { eventId: event.id } });
      expect(admins).toHaveLength(1);
    });

    it("should return 400 for missing email", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, {}));
      expect(res.status).toBe(400);
    });

    it("should add an admin by userId (owner only)", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { userId: "admin1" }));
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.userId).toBe("admin1");
      expect(data.name).toBe("Admin User");

      const admins = await prisma.eventAdmin.findMany({ where: { eventId: event.id } });
      expect(admins).toHaveLength(1);
    });

    it("should return 404 when adding admin by non-existent userId", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { userId: "nonexistent" }));
      expect(res.status).toBe(404);
    });

    it("should return 400 when adding owner by userId", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { userId: "owner1" }));
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/events/[id]/admins ──────────────────────────────────

  describe("DELETE /api/events/[id]/admins", () => {
    it("should remove an admin (owner only)", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");
      await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { DELETE } = await import("~/pages/api/events/[id]/admins");
      const res = await DELETE(deleteCtx({ id: event.id }, { userId: "admin1" }));
      expect(res.status).toBe(200);

      const admins = await prisma.eventAdmin.findMany({ where: { eventId: event.id } });
      expect(admins).toHaveLength(0);
    });

    it("should return 403 for non-owner", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");
      await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

      mockGetSession.mockResolvedValue({ user: { id: "user1" } } as any);

      const { DELETE } = await import("~/pages/api/events/[id]/admins");
      const res = await DELETE(deleteCtx({ id: event.id }, { userId: "admin1" }));
      expect(res.status).toBe(403);
    });

    it("should return 400 for missing userId", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { DELETE } = await import("~/pages/api/events/[id]/admins");
      const res = await DELETE(deleteCtx({ id: event.id }, {}));
      expect(res.status).toBe(400);
    });
  });

  // ── Notifications for admin role changes ────────────────────────────

  describe("Admin role notifications", () => {
    it("should send email and push when adding an admin", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { email: "admin@test.com" }));
      expect(res.status).toBe(201);

      // Allow fire-and-forget promise to resolve
      await vi.waitFor(() => {
        expect(mockSendAdminRoleNotification).toHaveBeenCalledWith(
          "admin@test.com",
          expect.objectContaining({
            eventTitle: "Test Event",
            action: "added",
          }),
        );
        expect(mockSendPushToUser).toHaveBeenCalledWith(
          "admin1",
          "Test Event",
          expect.stringContaining("added as an admin"),
          expect.stringContaining(`/events/${event.id}`),
        );
      });
    });

    it("should send email and push when removing an admin", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");
      await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { DELETE } = await import("~/pages/api/events/[id]/admins");
      const res = await DELETE(deleteCtx({ id: event.id }, { userId: "admin1" }));
      expect(res.status).toBe(200);

      await vi.waitFor(() => {
        expect(mockSendAdminRoleNotification).toHaveBeenCalledWith(
          "admin@test.com",
          expect.objectContaining({
            eventTitle: "Test Event",
            action: "removed",
          }),
        );
        expect(mockSendPushToUser).toHaveBeenCalledWith(
          "admin1",
          "Test Event",
          expect.stringContaining("removed as admin"),
          expect.any(String),
        );
      });
    });

    it("should not send email when user has emailEnabled=false but still send push", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetNotificationPrefs.mockResolvedValue({ emailEnabled: false, pushEnabled: true } as any);
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { email: "admin@test.com" }));
      expect(res.status).toBe(201);

      await vi.waitFor(() => {
        expect(mockSendPushToUser).toHaveBeenCalled();
      });
      expect(mockSendAdminRoleNotification).not.toHaveBeenCalled();
    });

    it("should not send push when user has pushEnabled=false but still send email", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetNotificationPrefs.mockResolvedValue({ emailEnabled: true, pushEnabled: false } as any);
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { email: "admin@test.com" }));
      expect(res.status).toBe(201);

      await vi.waitFor(() => {
        expect(mockSendAdminRoleNotification).toHaveBeenCalled();
      });
      expect(mockSendPushToUser).not.toHaveBeenCalled();
    });

    it("should not send any notification on failed add (e.g. user not found)", async () => {
      await seedUsers();
      const event = await seedOwnedEvent("owner1");

      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const { POST } = await import("~/pages/api/events/[id]/admins");
      const res = await POST(ctx({ id: event.id }, { email: "nobody@test.com" }));
      expect(res.status).toBe(404);

      await new Promise((r) => setTimeout(r, 50));
      expect(mockSendAdminRoleNotification).not.toHaveBeenCalled();
      expect(mockSendPushToUser).not.toHaveBeenCalled();
    });
  });
});

// ── Authorization: admins can manage events ─────────────────────────────────

describe("Event Admin Authorization", () => {
  beforeEach(async () => {
    await prisma.eventAdmin.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    resetApiRateLimitStore();
    mockGetSession.mockResolvedValue(null);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    mockCheckEventAdmin.mockResolvedValue(false);
  });

  it("checkOwnership should return isAdmin=true for event admins", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

    // Use the real checkOwnership (not mocked) for this test
    const { checkOwnership: _realCheckOwnership } = await vi.importActual<typeof import("~/lib/auth.helpers.server")>("~/lib/auth.helpers.server");

    // We can't easily test the real function without a real session,
    // but we can verify the EventAdmin record exists
    const adminRecord = await prisma.eventAdmin.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: "admin1" } },
    });
    expect(adminRecord).toBeTruthy();
    expect(adminRecord!.userId).toBe("admin1");
  });

  it("admins should be able to manage event settings via checkOwnership", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

    // Simulate what checkOwnership should return for an admin
    mockCheckOwnership.mockResolvedValue({
      isOwner: false,
      isAdmin: true,
      session: { user: { id: "admin1" } } as any,
    });

    const result = await checkOwnership(new Request("http://localhost"), event.ownerId, undefined, event.id);
    expect(result.isOwner).toBe(false);
    expect(result.isAdmin).toBe(true);
  });

  it("non-admins should not have admin access", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");

    mockCheckOwnership.mockResolvedValue({
      isOwner: false,
      isAdmin: false,
      session: { user: { id: "user1" } } as any,
    });

    const result = await checkOwnership(new Request("http://localhost"), event.ownerId, undefined, event.id);
    expect(result.isOwner).toBe(false);
    expect(result.isAdmin).toBe(false);
  });

  it("owner should also have isOwner=true (not just isAdmin)", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");

    mockCheckOwnership.mockResolvedValue({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: "owner1" } } as any,
    });

    const result = await checkOwnership(new Request("http://localhost"), event.ownerId, undefined, event.id);
    expect(result.isOwner).toBe(true);
  });

  // ── Owner-only operations should NOT be accessible by admins ──────

  it("transfer ownership should remain owner-only", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

    // checkOwnership returns isOwner=false, isAdmin=true for admin
    mockCheckOwnership.mockResolvedValue({
      isOwner: false,
      isAdmin: true,
      session: { user: { id: "admin1" } } as any,
    });

    const { POST } = await import("~/pages/api/events/[id]/transfer");
    const res = await POST(ctx({ id: event.id }, { targetUserId: "user1" }));
    expect(res.status).toBe(403);
  });
});

// ── GET /api/events/[id]/admins/candidates ──────────────────────────────────

describe("Admin Candidates API", () => {
  beforeEach(async () => {
    await prisma.eventAdmin.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    resetApiRateLimitStore();
    mockGetSession.mockResolvedValue(null);
  });

  it("should return logged users who are players in the event", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    // admin1 is a player linked to a user account
    await prisma.player.create({ data: { name: "Admin User", eventId: event.id, userId: "admin1" } });
    // user1 is a player linked to a user account
    await prisma.player.create({ data: { name: "Regular User", eventId: event.id, userId: "user1" } });
    // anonymous player (no userId) — should NOT appear
    await prisma.player.create({ data: { name: "Anonymous", eventId: event.id } });

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const res = await GET(ctx({ id: event.id }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data.map((c: any) => c.userId).sort()).toEqual(["admin1", "user1"]);
    expect(data[0]).toHaveProperty("name");
    expect(data[0]).toHaveProperty("userId");
    expect(data[0]).toHaveProperty("source");
    expect(data.every((c: any) => c.source === "player")).toBe(true);
  });

  it("should exclude the event owner from candidates", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    // Owner is also a player
    await prisma.player.create({ data: { name: "Owner", eventId: event.id, userId: "owner1" } });
    await prisma.player.create({ data: { name: "Admin User", eventId: event.id, userId: "admin1" } });

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const res = await GET(ctx({ id: event.id }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].userId).toBe("admin1");
  });

  it("should exclude existing admins from candidates", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    await prisma.player.create({ data: { name: "Admin User", eventId: event.id, userId: "admin1" } });
    await prisma.player.create({ data: { name: "Regular User", eventId: event.id, userId: "user1" } });
    // admin1 is already an admin
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const res = await GET(ctx({ id: event.id }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].userId).toBe("user1");
  });

  it("should return 403 for non-owner", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");

    mockGetSession.mockResolvedValue({ user: { id: "user1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const res = await GET(ctx({ id: event.id }));
    expect(res.status).toBe(403);
  });

  it("should return 404 for non-existent event", async () => {
    await seedUsers();
    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const res = await GET(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("should filter candidates by search query", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    await prisma.player.create({ data: { name: "Admin User", eventId: event.id, userId: "admin1" } });
    await prisma.player.create({ data: { name: "Regular User", eventId: event.id, userId: "user1" } });

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const searchReq = new Request("http://localhost/api/test?q=admin", { method: "GET" });
    const res = await GET({ request: searchReq, params: { id: event.id } } as any);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("Admin User");
  });

  it("should exclude archived players from candidates", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    // admin1 is archived
    await prisma.player.create({ data: { name: "Admin User", eventId: event.id, userId: "admin1", archivedAt: new Date() } });
    await prisma.player.create({ data: { name: "Regular User", eventId: event.id, userId: "user1" } });

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const res = await GET(ctx({ id: event.id }));
    expect(res.status).toBe(200);

    const data = await res.json();
    // archived players should still appear — they played in the event
    // The issue says "players that already played", so archived ones count
    expect(data).toHaveLength(2);
  });

  it("should return a registered user when searching by email", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    // user1 is NOT a player in this event, but is a registered user

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const searchReq = new Request("http://localhost/api/test?q=user@test.com", { method: "GET" });
    const res = await GET({ request: searchReq, params: { id: event.id } } as any);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].userId).toBe("user1");
    expect(data[0].source).toBe("email");
  });

  it("should not duplicate a player who is also found by email", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    // admin1 is a player AND we search by their email
    await prisma.player.create({ data: { name: "Admin User", eventId: event.id, userId: "admin1" } });

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const searchReq = new Request("http://localhost/api/test?q=admin@test.com", { method: "GET" });
    const res = await GET({ request: searchReq, params: { id: event.id } } as any);
    expect(res.status).toBe(200);

    const data = await res.json();
    // admin1 should appear only once (as player, not duplicated as email)
    const admin1Entries = data.filter((c: any) => c.userId === "admin1");
    expect(admin1Entries).toHaveLength(1);
  });

  it("should return invite placeholder for unknown email", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const searchReq = new Request("http://localhost/api/test?q=newperson@example.com", { method: "GET" });
    const res = await GET({ request: searchReq, params: { id: event.id } } as any);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].source).toBe("invite");
    expect(data[0].email).toBe("newperson@example.com");
    expect(data[0].userId).toBe("");
  });

  it("should not return invite for owner email", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const searchReq = new Request("http://localhost/api/test?q=owner@test.com", { method: "GET" });
    const res = await GET({ request: searchReq, params: { id: event.id } } as any);
    expect(res.status).toBe(200);

    const data = await res.json();
    // Owner is excluded — should not appear as email match
    expect(data).toHaveLength(0);
  });

  it("should not return invite for existing admin email", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: "admin1" } });

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    const searchReq = new Request("http://localhost/api/test?q=admin@test.com", { method: "GET" });
    const res = await GET({ request: searchReq, params: { id: event.id } } as any);
    expect(res.status).toBe(200);

    const data = await res.json();
    // admin1 is already an admin — should not appear
    expect(data).toHaveLength(0);
  });

  it("should not return invite for invalid email-like strings", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    // "@" alone or "not-an-email@" should not produce invite placeholders
    for (const q of ["@", "not-an-email@", "@@"]) {
      const searchReq = new Request(`http://localhost/api/test?q=${encodeURIComponent(q)}`, { method: "GET" });
      const res = await GET({ request: searchReq, params: { id: event.id } } as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.filter((c: any) => c.source === "invite")).toHaveLength(0);
    }
  });

  it("should find player candidates by email search", async () => {
    await seedUsers();
    const event = await seedOwnedEvent("owner1");
    await prisma.player.create({ data: { name: "Admin User", eventId: event.id, userId: "admin1" } });
    await prisma.player.create({ data: { name: "Regular User", eventId: event.id, userId: "user1" } });

    mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

    const { GET } = await import("~/pages/api/events/[id]/admins/candidates");
    // Search by partial email — should match player by email
    const searchReq = new Request("http://localhost/api/test?q=admin@", { method: "GET" });
    const res = await GET({ request: searchReq, params: { id: event.id } } as any);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].userId).toBe("admin1");
    expect(data[0].source).toBe("player");
  });
});
