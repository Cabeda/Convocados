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

vi.mock("~/lib/email.server", () => ({ sendGameInvite: vi.fn(), sendPlayerJoinedOwnerNotification: vi.fn(), sendPlayerInviteToRegister: vi.fn() }));
vi.mock("~/lib/push.server", () => ({ sendPushToUser: vi.fn() }));

import { POST as postRoster } from "~/pages/api/events/[id]/roster";

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
  return prisma.user.create({ data: { id: `u-${name}-${Math.random().toString(36).slice(2, 4)}`, name, email: email ?? `${name}${Math.random().toString(36).slice(2, 4)}@t.com`, emailVerified: true } });
}
async function seedEventWithGame(ownerId: string | null, dateTime = new Date(Date.now() + 48 * 3600_000)) {
  const event = await prisma.event.create({ data: { id: eid(), title: "Game", location: "Pitch", dateTime, ownerId, maxPlayers: 10 } });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

beforeEach(async () => {
  mockGetSession.mockReset();
  mockCheckEventAdmin.mockReset();
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.playerInvite.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("POST /api/events/[id]/roster (#814 unified endpoint)", () => {
  it("direct add (asInvite false) creates an active GameParticipant", async () => {
    const ev = await seedEventWithGame(null);
    const res = await postRoster(ctx({ id: ev.id }, { name: "Alice" }));
    expect(res.status).toBe(200);
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, name: "Alice" } });
    const gp = await prisma.gameParticipant.findFirstOrThrow({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } });
    expect(gp.status).toBe("active");
    expect(gp.archivedAt).toBeNull();
  });

  it("invite (asInvite true + userId) creates a pending PlayerInvite, not active", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee", "invitee-roster@example.com");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await postRoster(ctx({ id: ev.id }, { userId: invitee.id, asInvite: true }));
    expect(res.status).toBe(200);
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    const gp = await prisma.gameParticipant.findFirstOrThrow({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } });
    expect(gp.status).toBe("pending");
    const invite = await prisma.playerInvite.findFirstOrThrow({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } });
    expect(invite.status).toBe("pending");
  });

  it("link-only invite (asInvite true + deliver false) is silent — no notification channels", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee", "invitee-silent@example.com");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await postRoster(ctx({ id: ev.id }, { userId: invitee.id, asInvite: true, deliver: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.inviteUrl).toBe("string");
    expect(body.channels).toEqual({ email: false, webPush: false, appPush: false });
  });

  it("returns 404 for email with no registered user when inviting", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await postRoster(ctx({ id: ev.id }, { email: "nobody@example.com", asInvite: true }));
    expect(res.status).toBe(404);
  });

  it("requires auth for invites", async () => {
    const ev = await seedEventWithGame(null);
    mockGetSession.mockResolvedValue(null);
    const res = await postRoster(ctx({ id: ev.id }, { userId: "u-x", asInvite: true }));
    expect(res.status).toBe(401);
  });
});
