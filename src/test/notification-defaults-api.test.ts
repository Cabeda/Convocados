import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

import { checkOwnership } from "~/lib/auth.helpers.server";
const mockCheckOwnership = vi.mocked(checkOwnership);

import { GET as getDefaults, PUT as putDefaults } from "~/pages/api/events/[id]/notification-defaults";

function getCtx(params: Record<string, string>) {
  return { request: new Request("http://localhost/api/test"), params } as any;
}

function putCtx(params: Record<string, string>, body: unknown, raw = false) {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  return { request, params } as any;
}

async function seedEvent(notificationDefaults: string | null = null) {
  return prisma.event.create({
    data: {
      title: "Defaults Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: null,
      notificationDefaults,
    },
  });
}

beforeEach(async () => {
  await prisma.eventLog.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  mockCheckOwnership.mockReset();
});

describe("GET /api/events/[id]/notification-defaults", () => {
  it("returns 404 for a missing event", async () => {
    const res = await getDefaults(getCtx({ id: "nope" }));
    expect(res.status).toBe(404);
  });

  it("returns {} when no defaults set", async () => {
    const ev = await seedEvent(null);
    const res = await getDefaults(getCtx({ id: ev.id }));
    expect(await res.json()).toEqual({});
  });

  it("returns parsed defaults when present", async () => {
    const ev = await seedEvent(JSON.stringify({ muteReminders: true }));
    const res = await getDefaults(getCtx({ id: ev.id }));
    expect(await res.json()).toEqual({ muteReminders: true });
  });
});

describe("PUT /api/events/[id]/notification-defaults", () => {
  it("forbids non-owner non-admin", async () => {
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false } as any);
    const ev = await seedEvent();
    const res = await putDefaults(putCtx({ id: ev.id }, { muteReminders: true }));
    expect(res.status).toBe(403);
  });

  it("rejects invalid JSON", async () => {
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false } as any);
    const ev = await seedEvent();
    const res = await putDefaults(putCtx({ id: ev.id }, "not json{", true));
    expect(res.status).toBe(400);
  });

  it("rejects non-boolean field values", async () => {
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false } as any);
    const ev = await seedEvent();
    const res = await putDefaults(putCtx({ id: ev.id }, { muteReminders: "yes" }));
    expect(res.status).toBe(400);
  });

  it("merges new defaults with existing ones", async () => {
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false } as any);
    const ev = await seedEvent(JSON.stringify({ mutePostGame: true }));
    const res = await putDefaults(putCtx({ id: ev.id }, { muteReminders: true }));
    expect(await res.json()).toEqual({ mutePostGame: true, muteReminders: true });
  });

  it("removes a default when set to null", async () => {
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: true } as any);
    const ev = await seedEvent(JSON.stringify({ muteReminders: true }));
    const res = await putDefaults(putCtx({ id: ev.id }, { muteReminders: null }));
    expect(await res.json()).toEqual({});
    const stored = await prisma.event.findUnique({ where: { id: ev.id }, select: { notificationDefaults: true } });
    expect(stored?.notificationDefaults).toBeNull();
  });
});
