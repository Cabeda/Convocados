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

vi.mock("~/lib/geocode", () => ({ resolveLocation: vi.fn() }));

const { sendGameInviteMock, sendPushToUserMock } = vi.hoisted(() => ({
  sendGameInviteMock: vi.fn().mockResolvedValue(undefined),
  sendPushToUserMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/email.server", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, isEmailConfigured: () => true, sendGameInvite: sendGameInviteMock };
});

vi.mock("~/lib/push.server", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, sendPushToUser: sendPushToUserMock };
});

import { GET as getEvent } from "~/pages/api/events/[id]/index";
import {
  GET as getInvites, PATCH as resendInvite,
} from "~/pages/api/events/[id]/invites";
import {
  createPlayerInvite,
  resendPlayerInvite,
  InviteResendCooldownError,
  RESEND_COOLDOWN_MS,
} from "~/lib/invite.server";

function ctx(params: Record<string, string>, body?: unknown, method = "POST") {
  const request = new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

function eid() {
  return `e-${Math.random().toString(36).slice(2, 8)}`;
}

async function seedUser(name: string) {
  return prisma.user.create({
    data: { id: `u-${name}`, name, email: `${name}@t.com`, emailVerified: true },
  });
}

async function seedEventWithGame(ownerId: string | null, dateTime = new Date(Date.now() + 48 * 3600_000)) {
  const event = await prisma.event.create({
    data: { id: eid(), title: "Game", location: "Pitch", dateTime, ownerId, maxPlayers: 10 },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckEventAdmin.mockResolvedValue(false);
  sendGameInviteMock.mockClear();
  sendPushToUserMock.mockClear();
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.playerInvite.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.appPushToken.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

describe("invite channel persistence — ADR 0025 follow-up", () => {
  it("persists sentViaEmail=true when the invitee has the email channel enabled", async () => {
    const owner = await seedUser("owner");
    const invitee = await seedUser("invitee-email");
    await prisma.notificationPreferences.create({
      data: { userId: invitee.id, emailEnabled: true, gameInviteEmail: true },
    });

    const event = await seedEventWithGame(owner.id);
    const res = await createPlayerInvite({
      eventId: event.id,
      gameId: event.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "http://localhost",
    });

    expect(res.channels.email).toBe(true);
    const invite = await prisma.playerInvite.findUnique({ where: { token: res.token } });
    expect(invite?.sentViaEmail).toBe(true);
    expect(invite?.sentViaWebPush).toBe(false);
    expect(invite?.sentViaAppPush).toBe(false);
    expect(sendGameInviteMock).toHaveBeenCalledTimes(1);
  });

  it("persists sentViaAppPush=true when the invitee has an app push token", async () => {
    const owner = await seedUser("owner");
    const invitee = await seedUser("invitee-push");
    await prisma.notificationPreferences.create({
      data: { userId: invitee.id, pushEnabled: true, gameInvitePush: true },
    });
    await prisma.appPushToken.create({
      data: { userId: invitee.id, token: "tok-1", platform: "android" },
    });

    const event = await seedEventWithGame(owner.id);
    const res = await createPlayerInvite({
      eventId: event.id,
      gameId: event.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "http://localhost",
    });

    expect(res.channels.appPush).toBe(true);
    const invite = await prisma.playerInvite.findUnique({ where: { token: res.token } });
    expect(invite?.sentViaEmail).toBe(false);
    expect(invite?.sentViaWebPush).toBe(false);
    expect(invite?.sentViaAppPush).toBe(true);
  });

  it("persists all-false when no channel is enabled", async () => {
    const owner = await seedUser("owner");
    const invitee = await seedUser("invitee-none");

    const event = await seedEventWithGame(owner.id);
    const res = await createPlayerInvite({
      eventId: event.id,
      gameId: event.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "http://localhost",
    });

    expect(res.channels).toEqual({ email: false, webPush: false, appPush: false });
    const invite = await prisma.playerInvite.findUnique({ where: { token: res.token } });
    expect(invite?.sentViaEmail).toBe(false);
    expect(invite?.sentViaWebPush).toBe(false);
    expect(invite?.sentViaAppPush).toBe(false);
  });
});

describe("event payload exposes invite channels to admins", () => {
  it("GET /api/events/[id] includes channels + notifiedAt on invited entries for admins", async () => {
    const owner = await seedUser("owner");
    mockGetSession.mockResolvedValue({ user: owner });
    mockCheckEventAdmin.mockResolvedValue(true);

    const invitee = await seedUser("invited-view");
    await prisma.notificationPreferences.create({
      data: { userId: invitee.id, pushEnabled: true, gameInvitePush: true },
    });
    await prisma.appPushToken.create({
      data: { userId: invitee.id, token: "tok-2", platform: "ios" },
    });

    const event = await seedEventWithGame(owner.id);
    await createPlayerInvite({
      eventId: event.id,
      gameId: event.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "http://localhost",
    });

    const res = await getEvent(ctx({ id: event.id }, undefined, "GET"));
    const json = await res.json();
    expect(json.invited).toHaveLength(1);
    expect(json.invited[0].channels).toEqual({ email: false, webPush: false, appPush: true });
    expect(typeof json.invited[0].notifiedAt).toBe("string");
    expect(typeof json.invited[0].inviteId).toBe("string");
    expect(json.invited[0].id).toBeTruthy();
  });

  it("GET /api/events/[id]/invites includes sentVia* flags", async () => {
    const owner = await seedUser("owner");
    mockGetSession.mockResolvedValue({ user: owner });
    mockCheckEventAdmin.mockResolvedValue(true);

    const invitee = await seedUser("invited-list");
    const event = await seedEventWithGame(owner.id);
    await createPlayerInvite({
      eventId: event.id,
      gameId: event.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "http://localhost",
    });

    const res = await getInvites(ctx({ id: event.id }, undefined, "GET"));
    const json = await res.json();
    expect(json.invites).toHaveLength(1);
    expect(json.invites[0].sentViaEmail).toBe(false);
    expect(json.invites[0].sentViaAppPush).toBe(false);
    expect(json.invites[0].notifiedAt).toBeTruthy();
  });
});

describe("resendPlayerInvite", () => {
  async function seedPendingInvite(opts?: { notifiedAtOffsetMs?: number }) {
    const owner = await seedUser(`owner-${Math.random().toString(36).slice(2, 6)}`);
    const invitee = await seedUser(`invitee-${Math.random().toString(36).slice(2, 6)}`);
    await prisma.notificationPreferences.create({
      data: { userId: invitee.id, pushEnabled: true, gameInvitePush: true },
    });
    await prisma.appPushToken.create({
      data: { userId: invitee.id, token: `tok-${Math.random()}`, platform: "android" },
    });
    const event = await seedEventWithGame(owner.id);
    const created = await createPlayerInvite({
      eventId: event.id,
      gameId: event.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "http://localhost",
    });
    if (opts?.notifiedAtOffsetMs) {
      await prisma.playerInvite.update({
        where: { id: created.inviteId },
        data: {
          notifiedAt: new Date(Date.now() + opts.notifiedAtOffsetMs),
          createdAt: new Date(Date.now() + opts.notifiedAtOffsetMs),
        },
      });
    }
    const invitesBefore = await prisma.inAppNotification.count({ where: { userId: invitee.id } });
    return { owner, invitee, event, created, invitesBefore };
  }

  it("rejects a resend within the 24h cooldown with retryAfterSeconds", async () => {
    const { event, created, owner } = await seedPendingInvite();
    await expect(
      resendPlayerInvite({ eventId: event.id, inviteId: created.inviteId, requestedByUserId: owner.id, origin: "http://localhost" }),
    ).rejects.toBeInstanceOf(InviteResendCooldownError);
    try {
      await resendPlayerInvite({ eventId: event.id, inviteId: created.inviteId, requestedByUserId: owner.id, origin: "http://localhost" });
      expect.unreachable("expected InviteResendCooldownError");
    } catch (err) {
      expect(err).toBeInstanceOf(InviteResendCooldownError);
      const cooldownErr = err as InviteResendCooldownError;
      expect(cooldownErr.retryAfterSeconds).toBeGreaterThan(0);
      expect(cooldownErr.retryAfterSeconds).toBeLessThanOrEqual(RESEND_COOLDOWN_MS / 1000);
    }
  });

  it("allows a resend after 24h: re-notifies, bumps notifiedAt, recomputes channels", async () => {
    const { invitee, event, created, invitesBefore, owner } = await seedPendingInvite({ notifiedAtOffsetMs: -25 * 3600_000 });
    const t0 = Date.now();

    const res = await resendPlayerInvite({
      eventId: event.id,
      inviteId: created.inviteId,
      requestedByUserId: owner.id,
      origin: "http://localhost",
    });

    expect(res.channels.appPush).toBe(true);
    expect(res.inviteUrl).toBe(created.inviteUrl);

    const after = await prisma.playerInvite.findUnique({ where: { id: created.inviteId } });
    expect(after?.sentViaAppPush).toBe(true);
    expect(after?.notifiedAt!.getTime()).toBeGreaterThanOrEqual(t0 - 1000);

    const invitesAfter = await prisma.inAppNotification.count({ where: { userId: invitee.id } });
    expect(invitesAfter).toBe(invitesBefore + 1);
    expect(sendPushToUserMock).toHaveBeenCalledTimes(2); // once at create, once at resend
  });

  it("rejects a non-pending invite", async () => {
    const { event, created, owner } = await seedPendingInvite({ notifiedAtOffsetMs: -25 * 3600_000 });
    await prisma.playerInvite.update({
      where: { id: created.inviteId },
      data: { status: "declined" },
    });
    await expect(
      resendPlayerInvite({ eventId: event.id, inviteId: created.inviteId, requestedByUserId: owner.id, origin: "http://localhost" }),
    ).rejects.toThrow(/no longer pending/i);
  });

  it("rejects a caller that is not the owner, an admin, or the inviter", async () => {
    const { event, created } = await seedPendingInvite({ notifiedAtOffsetMs: -25 * 3600_000 });
    const outsider = await seedUser(`outsider-${Math.random().toString(36).slice(2, 6)}`);
    // outsider is NOT the owner, checkEventAdmin returns false (default mock), not the inviter
    await expect(
      resendPlayerInvite({ eventId: event.id, inviteId: created.inviteId, requestedByUserId: outsider.id, origin: "http://localhost" }),
    ).rejects.toThrow(/owner|admin|inviter/i);
  });

  it("allows the original inviter even without admin rights", async () => {
    const inviter = await seedUser(`inviter-${Math.random().toString(36).slice(2, 6)}`);
    const otherOwner = await seedUser(`other-${Math.random().toString(36).slice(2, 6)}`);
    const invitee = await seedUser(`invitee-${Math.random().toString(36).slice(2, 6)}`);

    const event = await seedEventWithGame(otherOwner.id);
    const created = await createPlayerInvite({
      eventId: event.id,
      gameId: event.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: inviter.id,
      origin: "http://localhost",
    });
    await prisma.playerInvite.update({
      where: { id: created.inviteId },
      data: { notifiedAt: new Date(Date.now() - 25 * 3600_000) },
    });

    const res = await resendPlayerInvite({
      eventId: event.id,
      inviteId: created.inviteId,
      requestedByUserId: inviter.id,
      origin: "http://localhost",
    });
    expect(res.channels).toBeDefined();
  });
});

describe("PATCH /api/events/[id]/invites — resend route", () => {
  it("returns ok + channels + notifiedAt for an eligible resend", async () => {
    const owner = await seedUser("route-owner");
    mockGetSession.mockResolvedValue({ user: owner });
    const invitee = await seedUser("route-invitee");
    const event = await seedEventWithGame(owner.id);
    const created = await createPlayerInvite({
      eventId: event.id,
      gameId: event.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "http://localhost",
    });
    await prisma.playerInvite.update({
      where: { id: created.inviteId },
      data: { notifiedAt: new Date(Date.now() - 25 * 3600_000) },
    });

    const res = await resendInvite(ctx({ id: event.id }, { inviteId: created.inviteId }, "PATCH"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.channels).toBeDefined();
    expect(typeof json.notifiedAt).toBe("string");
  });

  it("returns 429 with retryAfterSeconds during the cooldown", async () => {
    const owner = await seedUser("route-owner-2");
    mockGetSession.mockResolvedValue({ user: owner });
    const invitee = await seedUser("route-invitee-2");
    const event = await seedEventWithGame(owner.id);
    const created = await createPlayerInvite({
      eventId: event.id,
      gameId: event.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "http://localhost",
    });

    const res = await resendInvite(ctx({ id: event.id }, { inviteId: created.inviteId }, "PATCH"));
    const json = await res.json();
    expect(res.status).toBe(429);
    expect(json.error).toBeTruthy();
    expect(json.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("returns 401 unauthenticated", async () => {
    const res = await resendInvite(ctx({ id: "e-x" }, { inviteId: "i-x" }, "PATCH"));
    expect(res.status).toBe(401);
  });

  it("accepts EventPlayer id as fallback (historic UI sent gp.eventPlayer.id)", async () => {
    const owner = await seedUser("route-owner-fb");
    mockGetSession.mockResolvedValue({ user: owner });
    const invitee = await seedUser("route-invitee-fb");
    const event = await seedEventWithGame(owner.id);
    const created = await createPlayerInvite({
      eventId: event.id,
      gameId: event.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "http://localhost",
    });
    await prisma.playerInvite.update({
      where: { id: created.inviteId },
      data: { notifiedAt: new Date(Date.now() - 25 * 3600_000) },
    });
    const ep = await prisma.eventPlayer.findFirst({ where: { eventId: event.id, userId: invitee.id } });
    expect(ep).not.toBeNull();
    const res = await resendInvite(ctx({ id: event.id }, { inviteId: ep!.id }, "PATCH"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    // DB row should have been updated via the resolved PlayerInvite id
    const pi = await prisma.playerInvite.findUnique({ where: { id: created.inviteId } });
    expect(pi?.notifiedAt?.getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
