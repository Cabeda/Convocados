import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { hashPassword, verifyPassword } from "~/lib/eventAccess";

import { PUT as setAccess, GET as getAccess } from "~/pages/api/events/[id]/access";
import { POST as verifyAccess } from "~/pages/api/events/[id]/access/verify";
import { GET as getInvites, POST as addInvite, DELETE as removeInvite } from "~/pages/api/events/[id]/access/invites";

// Mock auth
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
}));

import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

function ctx(params: Record<string, string>, body?: unknown, method?: string, headers?: Record<string, string>) {
  const request = new Request("http://localhost/api/test", {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

function putCtx(params: Record<string, string>, body: unknown, headers?: Record<string, string>) {
  return ctx(params, body, "PUT", headers);
}

function deleteCtx(params: Record<string, string>, body: unknown) {
  return ctx(params, body, "DELETE");
}

async function seedOwnedEvent(ownerId: string) {
  // Ensure user exists
  await prisma.user.upsert({
    where: { id: ownerId },
    create: { id: ownerId, name: "Owner", email: `${ownerId}@test.com`, emailVerified: true },
    update: {},
  });
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

describe("Event Access Control API", () => {
  beforeEach(async () => {
    await prisma.eventInvite.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    resetApiRateLimitStore();
    mockGetSession.mockResolvedValue(null);
  });

  // ── Password management ──────────────────────────────────────────────

  describe("PUT /api/events/[id]/access", () => {
    it("should set a password (owner only)", async () => {
      const event = await seedOwnedEvent("owner1");
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const res = await setAccess(putCtx({ id: event.id }, { password: "secret123" }));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.hasPassword).toBe(true);

      // Verify it's stored hashed
      const updated = await prisma.event.findUnique({ where: { id: event.id } });
      expect(updated!.accessPassword).toBeTruthy();
      expect(updated!.accessPassword).not.toBe("secret123");
      expect(verifyPassword("secret123", updated!.accessPassword!)).toBe(true);
    });

    it("should remove a password", async () => {
      const event = await seedOwnedEvent("owner1");
      // Set password first
      await prisma.event.update({ where: { id: event.id }, data: { accessPassword: hashPassword("old") } });
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const res = await setAccess(putCtx({ id: event.id }, { password: null }));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.hasPassword).toBe(false);

      const updated = await prisma.event.findUnique({ where: { id: event.id } });
      expect(updated!.accessPassword).toBeNull();
    });

    it("should reject non-owner", async () => {
      const event = await seedOwnedEvent("owner1");
      mockGetSession.mockResolvedValue({ user: { id: "other" } } as any);

      const res = await setAccess(putCtx({ id: event.id }, { password: "test" }));
      expect(res.status).toBe(403);
    });

    it("should reject unauthenticated", async () => {
      const event = await seedOwnedEvent("owner1");
      const res = await setAccess(putCtx({ id: event.id }, { password: "test" }));
      expect(res.status).toBe(403);
    });

    it("should reject short password", async () => {
      const event = await seedOwnedEvent("owner1");
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const res = await setAccess(putCtx({ id: event.id }, { password: "ab" }));
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/events/[id]/access", () => {
    it("should return hasPassword: false for unprotected event", async () => {
      const event = await seedOwnedEvent("owner1");
      const res = await getAccess(ctx({ id: event.id }));
      const data = await res.json();
      expect(data.hasPassword).toBe(false);
    });

    it("should return hasPassword: true for protected event", async () => {
      const event = await seedOwnedEvent("owner1");
      await prisma.event.update({ where: { id: event.id }, data: { accessPassword: hashPassword("pw") } });

      const res = await getAccess(ctx({ id: event.id }));
      const data = await res.json();
      expect(data.hasPassword).toBe(true);
    });
  });

  // ── Password verification ────────────────────────────────────────────

  describe("POST /api/events/[id]/access/verify", () => {
    it("should return 200 and Set-Cookie for correct password", async () => {
      const event = await seedOwnedEvent("owner1");
      await prisma.event.update({ where: { id: event.id }, data: { accessPassword: hashPassword("mypass") } });

      const res = await verifyAccess(ctx({ id: event.id }, { password: "mypass" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Set-Cookie")).toContain("ev_access=");
    });

    it("should return 403 for incorrect password", async () => {
      const event = await seedOwnedEvent("owner1");
      await prisma.event.update({ where: { id: event.id }, data: { accessPassword: hashPassword("mypass") } });

      const res = await verifyAccess(ctx({ id: event.id }, { password: "wrong" }));
      expect(res.status).toBe(403);
    });

    it("should return 400 for event without password", async () => {
      const event = await seedOwnedEvent("owner1");
      const res = await verifyAccess(ctx({ id: event.id }, { password: "test" }));
      expect(res.status).toBe(400);
    });
  });

  // ── Invite management ────────────────────────────────────────────────

  describe("Invites CRUD", () => {
    it("should add and list invites", async () => {
      const event = await seedOwnedEvent("owner1");
      await prisma.user.create({ data: { id: "user2", name: "Player", email: "player@test.com", emailVerified: true } });
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      // Add invite
      const addRes = await addInvite(ctx({ id: event.id }, { email: "player@test.com" }));
      expect(addRes.status).toBe(201);
      const invite = await addRes.json();
      expect(invite.email).toBe("player@test.com");

      // List invites
      const listRes = await getInvites(ctx({ id: event.id }));
      const list = await listRes.json();
      expect(list).toHaveLength(1);
      expect(list[0].userId).toBe("user2");
    });

    it("should not allow inviting the owner", async () => {
      const event = await seedOwnedEvent("owner1");
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const res = await addInvite(ctx({ id: event.id }, { email: "owner1@test.com" }));
      expect(res.status).toBe(400);
    });

    it("should return 404 for unknown email", async () => {
      const event = await seedOwnedEvent("owner1");
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const res = await addInvite(ctx({ id: event.id }, { email: "nobody@test.com" }));
      expect(res.status).toBe(404);
    });

    it("should remove an invite", async () => {
      const event = await seedOwnedEvent("owner1");
      await prisma.user.create({ data: { id: "user2", name: "Player", email: "player@test.com", emailVerified: true } });
      await prisma.eventInvite.create({ data: { eventId: event.id, userId: "user2" } });
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      const res = await removeInvite(deleteCtx({ id: event.id }, { userId: "user2" }));
      expect(res.status).toBe(200);

      const remaining = await prisma.eventInvite.count({ where: { eventId: event.id } });
      expect(remaining).toBe(0);
    });

    it("should reject non-owner for invite operations", async () => {
      const event = await seedOwnedEvent("owner1");
      mockGetSession.mockResolvedValue({ user: { id: "other" } } as any);

      const listRes = await getInvites(ctx({ id: event.id }));
      expect(listRes.status).toBe(403);

      const addRes = await addInvite(ctx({ id: event.id }, { email: "x@test.com" }));
      expect(addRes.status).toBe(403);
    });

    it("should handle duplicate invites gracefully (upsert)", async () => {
      const event = await seedOwnedEvent("owner1");
      await prisma.user.create({ data: { id: "user2", name: "Player", email: "player@test.com", emailVerified: true } });
      mockGetSession.mockResolvedValue({ user: { id: "owner1" } } as any);

      await addInvite(ctx({ id: event.id }, { email: "player@test.com" }));
      const res = await addInvite(ctx({ id: event.id }, { email: "player@test.com" }));
      expect(res.status).toBe(201);

      const count = await prisma.eventInvite.count({ where: { eventId: event.id } });
      expect(count).toBe(1);
    });
  });
});
