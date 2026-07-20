import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/claim-player";
import { getSession } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx(eventId: string, body: any) {
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/claim-player`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any;
}

describe("POST /api/events/[id]/claim-player", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(ctx("e1", { playerId: "p1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when playerId is missing", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", name: "User" } } as any);
    const res = await POST(ctx("e1", {}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when event not found", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", name: "User" } } as any);
    const res = await POST(ctx("nonexistent", { playerId: "p1" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when player not found in event", async () => {
    const event = await prisma.event.create({
      data: { title: "Game", location: "L", dateTime: new Date(), maxPlayers: 10 },
    });
    mockGetSession.mockResolvedValue({ user: { id: "u1", name: "User" } } as any);
    const res = await POST(ctx(event.id, { playerId: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("returns 409 when player already linked to an account", async () => {
    const user = await prisma.user.create({
      data: { id: "u1", name: "User", email: "u@t.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { title: "Game", location: "L", dateTime: new Date(), maxPlayers: 10 },
    });
    const player = await prisma.player.create({
      data: { name: "Linked", eventId: event.id, userId: user.id },
    });
    mockGetSession.mockResolvedValue({ user: { id: "u2", name: "Other" } } as any);
    const res = await POST(ctx(event.id, { playerId: player.id }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already linked");
  });

  it("returns 409 when user already has a player in the event", async () => {
    const user = await prisma.user.create({
      data: { id: "u1", name: "User", email: "u@t.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { title: "Game", location: "L", dateTime: new Date(), maxPlayers: 10 },
    });
    // User already has a linked player
    await prisma.player.create({ data: { name: "User", eventId: event.id, userId: user.id } });
    // Anonymous player to claim
    const anon = await prisma.player.create({ data: { name: "Anon", eventId: event.id } });
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const res = await POST(ctx(event.id, { playerId: anon.id }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already have a linked player");
  });

  it("successfully claims an anonymous player", async () => {
    const user = await prisma.user.create({
      data: { id: "u1", name: "User", email: "u@t.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { title: "Game", location: "L", dateTime: new Date(), maxPlayers: 10 },
    });
    const anon = await prisma.player.create({ data: { name: "Anon", eventId: event.id } });
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const res = await POST(ctx(event.id, { playerId: anon.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.claimedPlayerId).toBe(anon.id);

    // Verify the player is now linked
    const updated = await prisma.player.findUnique({ where: { id: anon.id } });
    expect(updated!.userId).toBe(user.id);
    expect(updated!.name).toBe("User");
  });

  // ADR 0016 regression: the event GET returns EventPlayer ids, so the Rankings
  // page sends an EventPlayer id here. Resolve it via name-match.
  it("successfully claims when given an EventPlayer id", async () => {
    const user = await prisma.user.create({
      data: { id: "u1", name: "User", email: "u@t.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { title: "Game", location: "L", dateTime: new Date(), maxPlayers: 10 },
    });
    const anon = await prisma.player.create({ data: { name: "Anon", eventId: event.id } });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Anon" } });
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const res = await POST(ctx(event.id, { playerId: ep.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const updated = await prisma.player.findUnique({ where: { id: anon.id } });
    expect(updated!.userId).toBe(user.id);
    expect(updated!.name).toBe("User");
  });
});
