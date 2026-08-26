/**
 * Link-only invites (dex follow-up to #830): the add-or-invite dialog gains a
 * "share an invite link" action that creates the PlayerInvite token WITHOUT
 * notifying the invitee — no email, no push, no in-app notification. The
 * sender delivers the link themselves (Web Share API), which is less
 * intrusive for friend-to-friend invites.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const mockGetSession = vi.fn().mockResolvedValue(null);
const mockCheckEventAdmin = vi.fn().mockResolvedValue(false);
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: false, session: null }),
  checkEventAdmin: (...args: any[]) => mockCheckEventAdmin(...args),
}));
vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST as createInviteRoute } from "~/pages/api/events/[id]/invites";

function postCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckEventAdmin.mockResolvedValue(false);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.inAppNotification.deleteMany();
  await prisma.notificationJob.deleteMany();
  await prisma.playerInvite.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.appPushToken.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

async function seedOwnerAndEvent() {
  const owner = await prisma.user.create({
    data: { id: `u-owner-${Math.random().toString(36).slice(2, 6)}`, name: "Owner", email: "owner@t.com", emailVerified: true },
  });
  const event = await prisma.event.create({
    data: { id: `e-${Math.random().toString(36).slice(2, 8)}`, title: "Game", location: "Pitch", dateTime: new Date(Date.now() + 48 * 3600_000), ownerId: owner.id, maxPlayers: 10 },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { owner, event, gameId: game.id };
}

describe("POST /api/events/[id]/invites — link-only delivery", () => {
  it("deliver:false creates a pending invite without any invitee-facing notification", async () => {
    const { owner, event, gameId } = await seedOwnerAndEvent();
    const invitee = await prisma.user.create({
      data: { id: `u-inv-${Math.random().toString(36).slice(2, 6)}`, name: "Luís Lopes", email: "luis@t.com", emailVerified: true },
    });

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await createInviteRoute(postCtx({ id: event.id }, { userId: invitee.id, deliver: false }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.inviteUrl).toContain("/invite/");
    expect(json.channels).toEqual({ email: false, webPush: false, appPush: false });

    const saved = await prisma.playerInvite.findFirstOrThrow({});
    expect(saved.status).toBe("pending");
    expect(saved.token).toBeTruthy();
    expect(saved.notifiedAt).toBeNull();
    expect(saved.sentViaEmail).toBe(false);
    expect(saved.sentViaWebPush).toBe(false);
    expect(saved.sentViaAppPush).toBe(false);

    // The intrusive surfaces stay silent
    expect(await prisma.inAppNotification.count({ where: { userId: invitee.id } })).toBe(0);

    // Roster ghost pairing is still intact
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, userId: invitee.id } });
    const gp = await prisma.gameParticipant.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
    });
    expect(gp.status).toBe("pending");
  });

  it("default delivery still notifies (guard against regressions)", async () => {
    const { owner, event } = await seedOwnerAndEvent();
    const invitee = await prisma.user.create({
      data: { id: `u-inv-${Math.random().toString(36).slice(2, 6)}`, name: "Joana", email: "joana@t.com", emailVerified: true },
    });

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await createInviteRoute(postCtx({ id: event.id }, { userId: invitee.id }));
    expect(res.status).toBe(200);

    const saved = await prisma.playerInvite.findFirstOrThrow({});
    expect(saved.notifiedAt).not.toBeNull();
    expect(await prisma.inAppNotification.count({ where: { userId: invitee.id } })).toBe(1);
  });
});
