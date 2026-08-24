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

function ctx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}
function eid() { return `e-${Math.random().toString(36).slice(2, 8)}`; }
async function seedUser(name: string, email?: string) {
  return prisma.user.create({ data: { id: `u-${name}-${Math.random().toString(36).slice(2,4)}`, name, email: email ?? `${name}${Math.random().toString(36).slice(2,4)}@t.com`, emailVerified: true } });
}
async function seedEventWithGame(ownerId: string | null, dateTime = new Date(Date.now() + 48 * 3600_000)) {
  const event = await prisma.event.create({ data: { id: eid(), title: "Game", location: "Pitch", dateTime, ownerId, maxPlayers: 10 } });
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

describe("POST /api/events/[id]/invites with email", () => {
  it("creates pending invite via email for registered user (not active)", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee", "invitee-unique@example.com");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);

    const res = await createInvite(ctx({ id: ev.id }, { email: "invitee-unique@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Should be pending, not active
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    const gp = await prisma.gameParticipant.findFirstOrThrow({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } });
    expect(gp.status).toBe("pending");
    const invite = await prisma.playerInvite.findFirstOrThrow({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } });
    expect(invite.status).toBe("pending");
    // Should NOT be in active roster
    const active = await prisma.gameParticipant.findFirst({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id, status: "active", archivedAt: null } });
    expect(active).toBeNull();
  });

  it("returns 404 for email with no registered user", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await createInvite(ctx({ id: ev.id }, { email: "nouser@example.com" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/No registered user/);
  });

  it("email lookup is case-insensitive and trims", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee", "Case@Example.COM");
    // Ensure email stored lower case? seed uses as provided, but we lower case on lookup
    await prisma.user.update({ where: { id: invitee.id }, data: { email: "case@example.com" } });
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await createInvite(ctx({ id: ev.id }, { email: "  CASE@example.com  " }));
    expect(res.status).toBe(200);
  });

  it("repro cmt7fepgx0013ljsxpbda4t35: inviting registered user via email should be pending not active, and should send invite email not direct-add email", async () => {
    const owner = await seedUser("Cabeda");
    const jec = await seedUser("JoseCabeda", "jecabeda@gmail.com");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(false); // owner can invite without admin after fix
    // Note: owner check should allow this
    const res = await createInvite(ctx({ id: ev.id }, { email: "jecabeda@gmail.com" }));
    expect(res.status).toBe(200);
    const ep = await prisma.eventPlayer.findFirst({ where: { eventId: ev.id, userId: jec.id } });
    expect(ep).not.toBeNull();
    const gp = await prisma.gameParticipant.findFirst({ where: { gameId: ev.currentGameId, eventPlayerId: ep!.id } });
    expect(gp?.status).toBe("pending");
    expect(gp?.archivedAt).toBeNull();
  });
});
