import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock auth
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

import { checkOwnership } from "~/lib/auth.helpers.server";
const mockCheckOwnership = vi.mocked(checkOwnership);

import { PUT as archiveEvent } from "~/pages/api/events/[id]/archive";

function putCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

async function seedOwner() {
  await prisma.user.upsert({
    where: { id: "owner1" },
    create: { id: "owner1", name: "Owner", email: "owner@test.com", emailVerified: true },
    update: {},
  });
}

async function seedEvent(ownerId: string | null = "owner1") {
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId,
    },
  });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.eventLog.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("PUT /api/events/[id]/archive", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await archiveEvent(putCtx({ id: "nonexistent" }, { archive: true }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-owner tries to archive", async () => {
    await seedOwner();
    const event = await seedEvent("owner1");

    mockCheckOwnership.mockResolvedValueOnce({
      isOwner: false,
      isAdmin: false,
      session: { user: { id: "other" } } as any,
    });

    const res = await archiveEvent(putCtx({ id: event.id }, { archive: true }));
    expect(res.status).toBe(403);
  });

  it("allows owner to archive an event", async () => {
    await seedOwner();
    const event = await seedEvent("owner1");

    mockCheckOwnership.mockResolvedValueOnce({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: "owner1", name: "Owner" } } as any,
    });

    const res = await archiveEvent(putCtx({ id: event.id }, { archive: true }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.archivedAt).toBeTruthy();

    // Verify in DB
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.archivedAt).toBeTruthy();
  });

  it("allows owner to unarchive an event", async () => {
    await seedOwner();
    const event = await seedEvent("owner1");

    // First archive it
    await prisma.event.update({
      where: { id: event.id },
      data: { archivedAt: new Date() },
    });

    mockCheckOwnership.mockResolvedValueOnce({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: "owner1", name: "Owner" } } as any,
    });

    const res = await archiveEvent(putCtx({ id: event.id }, { archive: false }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.archivedAt).toBeNull();

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.archivedAt).toBeNull();
  });

  it("does not allow admins to archive (owner-only)", async () => {
    await seedOwner();
    const event = await seedEvent("owner1");

    mockCheckOwnership.mockResolvedValueOnce({
      isOwner: false,
      isAdmin: true,
      session: { user: { id: "admin1" } } as any,
    });

    const res = await archiveEvent(putCtx({ id: event.id }, { archive: true }));
    expect(res.status).toBe(403);
  });

  it("creates an event log entry when archiving", async () => {
    await seedOwner();
    const event = await seedEvent("owner1");

    mockCheckOwnership.mockResolvedValueOnce({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: "owner1", name: "Owner" } } as any,
    });

    await archiveEvent(putCtx({ id: event.id }, { archive: true }));

    const logs = await prisma.eventLog.findMany({ where: { eventId: event.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("event_archived");
  });

  it("creates an event log entry when unarchiving", async () => {
    await seedOwner();
    const event = await seedEvent("owner1");
    await prisma.event.update({
      where: { id: event.id },
      data: { archivedAt: new Date() },
    });

    mockCheckOwnership.mockResolvedValueOnce({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: "owner1", name: "Owner" } } as any,
    });

    await archiveEvent(putCtx({ id: event.id }, { archive: false }));

    const logs = await prisma.eventLog.findMany({ where: { eventId: event.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("event_unarchived");
  });

  it("does not allow archiving ownerless events", async () => {
    const event = await seedEvent(null);

    mockCheckOwnership.mockResolvedValueOnce({
      isOwner: false,
      isAdmin: false,
      session: null,
    });

    const res = await archiveEvent(putCtx({ id: event.id }, { archive: true }));
    expect(res.status).toBe(403);
  });
});
