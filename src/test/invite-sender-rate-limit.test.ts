import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const mockGetSession = vi.fn().mockResolvedValue(null);
const mockCheckEventAdmin = vi.fn().mockResolvedValue(false);
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkEventAdmin: (...args: any[]) => mockCheckEventAdmin(...args),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: false, session: null }),
}));

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { POST as createInvite } from "~/pages/api/events/[id]/invites";

function ctx(eventId: string, body: unknown) {
  const request = new Request(`http://localhost/api/events/${eventId}/invites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: { id: eventId }, url: new URL(request.url) } as any;
}

async function seedUser(name: string) {
  return prisma.user.create({
    data: { id: `u-${name}-${Math.random().toString(36).slice(2, 6)}`, name, email: `${name}${Math.random().toString(36).slice(2, 6)}@t.com`, emailVerified: true },
  });
}

async function seedEventWithGame(ownerId: string | null) {
  const dateTime = new Date(Date.now() + 48 * 3600_000);
  const event = await prisma.event.create({
    data: { id: `e-${Math.random().toString(36).slice(2, 8)}`, title: "Game", location: "Pitch", dateTime, ownerId, maxPlayers: 10 },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

beforeEach(async () => {
  mockGetSession.mockReset();
  mockCheckEventAdmin.mockResolvedValue(false);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.playerInvite.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("POST /api/events/[id]/invites — per-sender rate limit (ADR 0025)", () => {
  it("caps a sender at 20 invite requests per 24h", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);

    for (let i = 0; i < 20; i++) {
      const res = await createInvite(ctx(ev.id, { name: "Guest" }));
      expect(res.status).toBe(200);
    }

    const blocked = await createInvite(ctx(ev.id, { name: "Guest" }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("keys the limit per sender, not globally", async () => {
    const owner = await seedUser("Owner");
    const other = await seedUser("Other");
    const ev = await seedEventWithGame(owner.id);
    mockCheckEventAdmin.mockResolvedValue(true);

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    for (let i = 0; i < 20; i++) {
      const res = await createInvite(ctx(ev.id, { name: "Guest" }));
      expect(res.status).toBe(200);
    }
    // Owner is now capped.
    expect((await createInvite(ctx(ev.id, { name: "Guest" }))).status).toBe(429);

    // A different sender still has their full allowance.
    mockGetSession.mockResolvedValue({ user: { id: other.id } });
    const otherRes = await createInvite(ctx(ev.id, { name: "Guest 2" }));
    expect(otherRes.status).toBe(200);
  });
});
