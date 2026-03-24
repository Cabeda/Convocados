import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// We'll import the archive endpoint once created
import { PUT as archivePlayer } from "~/pages/api/events/[id]/archive-player";
import { GET as getEvent } from "~/pages/api/events/[id]/index";

// Mock auth helpers
vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<any>("~/lib/auth.helpers.server");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue(null),
    checkOwnership: vi.fn().mockResolvedValue({ isOwner: false, isAdmin: false, session: null }),
  };
});

import { getSession, checkOwnership } from "~/lib/auth.helpers.server";

function putCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

function getCtx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

async function seedEventWithPlayers() {
  const owner = await prisma.user.upsert({
    where: { email: "owner-archive@test.com" },
    create: { id: "owner-archive", name: "Owner", email: "owner-archive@test.com", emailVerified: true },
    update: {},
  });
  const event = await prisma.event.create({
    data: {
      title: "Archive Test",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 10,
      ownerId: owner.id,
    },
  });
  const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
  const p2 = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });
  const p3 = await prisma.player.create({ data: { name: "Charlie", eventId: event.id, order: 2 } });
  return { event, owner, players: [p1, p2, p3] };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetApiRateLimitStore();
  await prisma.eventLog.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

describe("Archive players (#173)", () => {
  it("owner can archive a player", async () => {
    const { event, owner, players } = await seedEventWithPlayers();
    vi.mocked(checkOwnership).mockResolvedValue({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: owner.id, name: owner.name } } as any,
    });

    const res = await archivePlayer(putCtx({ id: event.id }, { playerId: players[0].id, archive: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archivedAt).toBeTruthy();

    // Verify in DB
    const player = await prisma.player.findUnique({ where: { id: players[0].id } });
    expect(player!.archivedAt).not.toBeNull();
  });

  it("owner can unarchive a player", async () => {
    const { event, owner, players } = await seedEventWithPlayers();
    // First archive
    await prisma.player.update({ where: { id: players[0].id }, data: { archivedAt: new Date() } });

    vi.mocked(checkOwnership).mockResolvedValue({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: owner.id, name: owner.name } } as any,
    });

    const res = await archivePlayer(putCtx({ id: event.id }, { playerId: players[0].id, archive: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archivedAt).toBeNull();

    const player = await prisma.player.findUnique({ where: { id: players[0].id } });
    expect(player!.archivedAt).toBeNull();
  });

  it("non-owner cannot archive a player", async () => {
    const { event, players } = await seedEventWithPlayers();
    vi.mocked(checkOwnership).mockResolvedValue({
      isOwner: false,
      isAdmin: false,
      session: null,
    });

    const res = await archivePlayer(putCtx({ id: event.id }, { playerId: players[0].id, archive: true }));
    expect(res.status).toBe(403);
  });

  it("admin can archive a player", async () => {
    const { event, players } = await seedEventWithPlayers();
    vi.mocked(checkOwnership).mockResolvedValue({
      isOwner: false,
      isAdmin: true,
      session: { user: { id: "admin-1", name: "Admin" } } as any,
    });

    const res = await archivePlayer(putCtx({ id: event.id }, { playerId: players[1].id, archive: true }));
    expect(res.status).toBe(200);
  });

  it("returns 404 for non-existent player", async () => {
    const { event, owner } = await seedEventWithPlayers();
    vi.mocked(checkOwnership).mockResolvedValue({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: owner.id, name: owner.name } } as any,
    });

    const res = await archivePlayer(putCtx({ id: event.id }, { playerId: "nonexistent", archive: true }));
    expect(res.status).toBe(404);
  });

  it("archived players are excluded from event GET response", async () => {
    const { event, players } = await seedEventWithPlayers();
    // Archive Alice
    await prisma.player.update({ where: { id: players[0].id }, data: { archivedAt: new Date() } });

    const res = await getEvent(getCtx({ id: event.id }));
    const body = await res.json();
    const names = body.players.map((p: any) => p.name);
    expect(names).not.toContain("Alice");
    expect(names).toContain("Bob");
    expect(names).toContain("Charlie");
  });

  it("returns 400 when playerId is missing", async () => {
    const { event, owner } = await seedEventWithPlayers();
    vi.mocked(checkOwnership).mockResolvedValue({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: owner.id, name: owner.name } } as any,
    });

    const res = await archivePlayer(putCtx({ id: event.id }, { archive: true }));
    expect(res.status).toBe(400);
  });
});
