import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/adopt";
import { getSession } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);

const mockEnqueue = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: (...args: unknown[]) => mockEnqueue(...args),
}));

beforeEach(async () => {
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx(eventId: string) {
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/adopt`, { method: "POST" }),
  } as any;
}

async function pickupEvent(userId?: string) {
  const event = await prisma.event.create({
    data: {
      title: "Padel — Club (Thu 19:30)",
      location: "Club",
      dateTime: new Date(Date.now() + 24 * 3600_000),
      maxPlayers: 4,
      durationMinutes: 90,
      sport: "padel",
      isPublic: true,
      source: "playtomic",
      sourceKey: "tenant-1|court-1|2026-06-18|19:30",
      playtomicTenantId: "tenant-1",
      playtomicTenantName: "Club",
      ownerId: userId ?? null,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return event;
}

describe("POST /api/events/[id]/adopt", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(ctx("e1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when event not found", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", name: "U" } } as any);
    const res = await POST(ctx("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when the event already has an owner", async () => {
    const owner = await prisma.user.create({ data: { id: "u0", name: "Owner", email: "o@t.com", emailVerified: true } });
    const pickup = await pickupEvent(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: "u1", name: "U" } } as any);
    const res = await POST(ctx(pickup.id));
    expect(res.status).toBe(409);
  });

  it("returns 409 when the event is not a pickup (manual source)", async () => {
    const event = await prisma.event.create({
      data: { title: "Manual", location: "L", dateTime: new Date(Date.now() + 24 * 3600_000), maxPlayers: 10, source: "manual" },
    });
    mockGetSession.mockResolvedValue({ user: { id: "u1", name: "U" } } as any);
    const res = await POST(ctx(event.id));
    expect(res.status).toBe(409);
  });

  it("adopts the pickup: sets the owner, keeps it public, notifies followers", async () => {
    const user = await prisma.user.create({ data: { id: "u1", name: "Adopter", email: "a@t.com", emailVerified: true } });
    const follower = await prisma.user.create({ data: { id: "u2", name: "Follower", email: "f@t.com", emailVerified: true } });
    const pickup = await pickupEvent();
    await prisma.eventFollow.create({ data: { eventId: pickup.id, userId: follower.id } });

    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const res = await POST(ctx(pickup.id));
    expect(res.status).toBe(200);

    const updated = await prisma.event.findUnique({ where: { id: pickup.id } });
    expect(updated!.ownerId).toBe(user.id);
    expect(updated!.isPublic).toBe(true);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const [eventId, type, payload] = mockEnqueue.mock.calls[0];
    expect(eventId).toBe(pickup.id);
    expect(type).toBe("event_details");
    expect(payload.params.name).toBe("Adopter");
  });
});