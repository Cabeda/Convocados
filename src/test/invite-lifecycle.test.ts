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

import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { GET as inviteLookup, POST as inviteTokenPost } from "~/pages/api/invite/[token]";
import {
  POST as createInvite, DELETE as retractInvite, GET as getInvites,
} from "~/pages/api/events/[id]/invites";
import { createPlayerInvite, acceptPlayerInvite, declinePlayerInvite, expirePendingInvites, getInviteChannels } from "~/lib/invite.server";
import * as inviteServer from "~/lib/invite.server";
import * as pushServer from "~/lib/push.server";
import * as emailServer from "~/lib/email.server";

function ctx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

function deleteCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

/** Request with a malformed JSON body (tests the try/catch parse branches). */
function rawCtx(params: Record<string, string>, method = "POST", rawBody = "not-json") {
  const request = new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: rawBody,
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

function eid() { return `e-${Math.random().toString(36).slice(2, 8)}`; }

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
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.notificationJob.deleteMany();
  await prisma.playerInvite.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.appPushToken.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("createPlayerInvite", () => {
  it("creates EventPlayer shell + pending GameParticipant + PlayerInvite with token", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);

    const result = await createPlayerInvite({
      eventId: ev.id,
      gameId: ev.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://convocados.cabeda.dev",
    });

    expect(result.token).toBeTruthy();
    expect(result.inviteUrl).toBe(`https://convocados.cabeda.dev/invite/${result.token}`);

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    const gp = await prisma.gameParticipant.findFirstOrThrow({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } });
    expect(gp.status).toBe("pending");
    const invite = await prisma.playerInvite.findFirstOrThrow({ where: { id: result.inviteId } });
    expect(invite.status).toBe("pending");
    expect(invite.invitedByUserId).toBe(owner.id);
    expect(invite.notifiedAt).not.toBeNull();
  });

  it("creates an in-app notification for the invitee only", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);

    await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    const notif = await prisma.inAppNotification.findFirstOrThrow({ where: { userId: invitee.id } });
    expect(notif.type).toBe("player_invited");
    expect(notif.url).toContain("/invite/");
  });

  it("renders the invite push in the inviter's language", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    await prisma.appPushToken.create({
      data: { userId: owner.id, token: `pt-token-${Date.now()}`, platform: "android", locale: "pt" },
    });
    // The invitee must have a registered device for the push channel to fire.
    await prisma.appPushToken.create({
      data: { userId: invitee.id, token: `invitee-token-${Date.now()}`, platform: "android", locale: "en" },
    });

    const spy = vi.spyOn(pushServer, "sendPushToUser").mockResolvedValue(undefined);
    try {
      await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });
      expect(spy).toHaveBeenCalledTimes(1);
      const [userId, , body, url, extras] = spy.mock.calls[0];
      expect(body).toContain("Foste convidado para jogar em");
      expect(body).not.toContain("You've been invited");
      // ADR 0025: tap opens the event page; FCM data carries token + context
      // (sport · ISO time · place) so Android can render informed quick actions.
      expect(url).toBe(`/events/${ev.id}`);
      expect(extras).toMatchObject({
        type: "player_invited",
        eventId: ev.id,
        sport: expect.any(String),
        startsAt: expect.any(String),
        inviteToken: expect.any(String),
      });
      void userId;
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to English for the invite push when the inviter has no push locale", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    await prisma.appPushToken.create({
      data: { userId: invitee.id, token: `invitee-token-${Date.now()}`, platform: "android", locale: "en" },
    });

    const spy = vi.spyOn(pushServer, "sendPushToUser").mockResolvedValue(undefined);
    try {
      await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });
      const [, , body] = spy.mock.calls[0];
      expect(body).toContain("You've been invited");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("POST /api/events/[id]/invites", () => {
  async function seedInvitableEvent() {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    return { owner, invitee, ev };
  }

  it("creates an invite as owner/admin", async () => {
    const { owner, invitee, ev } = await seedInvitableEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeTruthy();
  });

  it("allows owner without admin or player role to create invite (repro cmt7cxlv70001ljsxlbom6ump)", async () => {
    const owner = await seedUser("Owner2");
    const invitee = await seedUser("Invitee2");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(false);

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects non-admin senders", async () => {
    const owner = await seedUser("Owner");
    const stranger = await seedUser("Stranger");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: stranger.id } });
    mockCheckEventAdmin.mockResolvedValue(false);

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(403);
  });

  it("allows a player who has played in the event to invite (no admin role)", async () => {
    const owner = await seedUser("Owner");
    const player = await seedUser("Player");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const playerEp = await prisma.eventPlayer.create({ data: { eventId: ev.id, name: player.name, userId: player.id } });
    await prisma.gameParticipant.create({ data: { gameId: ev.currentGameId, eventPlayerId: playerEp.id, status: "active" } });
    mockGetSession.mockResolvedValue({ user: { id: player.id } });
    mockCheckEventAdmin.mockResolvedValue(false);

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(200);
  });

  it("blocks users who opted out of invites for this event", async () => {
    const { owner, invitee, ev } = await seedInvitableEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    await prisma.eventPlayer.create({ data: { eventId: ev.id, name: invitee.name, userId: invitee.id, invitationOptOutAt: new Date() } });

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(409);
  });

  it("blocks users with the global invites kill switch off", async () => {
    const { owner, invitee, ev } = await seedInvitableEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    await prisma.notificationPreferences.create({ data: { userId: invitee.id, invitesEnabled: false } });

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(409);
  });

  it("blocks users who declined this game", async () => {
    const { owner, invitee, ev } = await seedInvitableEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const ep = await prisma.eventPlayer.create({ data: { eventId: ev.id, name: invitee.name, userId: invitee.id } });
    await prisma.rsvp.create({ data: { eventPlayerId: ep.id, gameId: ev.currentGameId, status: "no", respondedAt: new Date() } });

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(409);
  });

  it("blocks users with a pending invite already", async () => {
    const { owner, invitee, ev } = await seedInvitableEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/pending invite/i);
  });

  it("blocks users with noShowStreak >= 2", async () => {
    const { owner, invitee, ev } = await seedInvitableEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    await prisma.priorityEnrollment.create({ data: { eventId: ev.id, userId: invitee.id, noShowStreak: 2 } });

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(409);
  });

  it("rejects invites after kickoff", async () => {
    const { owner, invitee, ev } = await seedInvitableEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    await prisma.event.update({ where: { id: ev.id }, data: { dateTime: new Date(Date.now() - 1000) } });

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated senders", async () => {
    const { invitee, ev } = await seedInvitableEvent();
    mockGetSession.mockResolvedValue(null);
    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(401);
  });

  it("404 for an unknown event", async () => {
    const { invitee } = await seedInvitableEvent();
    mockGetSession.mockResolvedValue({ user: { id: "u-any" } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await createInvite(ctx({ id: "e-unknown" }, { userId: invitee.id }));
    expect(res.status).toBe(404);
  });

  it("400 when the event has no current game", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await prisma.event.create({ data: { id: eid(), title: "Game", location: "Pitch", dateTime: new Date(Date.now() + 48 * 3600_000), ownerId: owner.id, maxPlayers: 10 } });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(400);
  });

  it("400 on malformed JSON", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await createInvite(rawCtx({ id: ev.id }));
    expect(res.status).toBe(400);
  });

  it("400 when userId is missing or not a string", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await createInvite(ctx({ id: ev.id }, {}));
    expect(res.status).toBe(400);
  });

  it("400 when invite creation fails server-side", async () => {
    const { owner, invitee, ev } = await seedInvitableEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const spy = vi.spyOn(inviteServer, "createPlayerInvite").mockRejectedValue(new Error("boom"));
    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(400);
    spy.mockRestore();
  });
});

describe("GET /api/events/[id]/invites", () => {
  it("401 when unauthenticated", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue(null);
    const res = await getInvites(ctx({ id: ev.id }));
    expect(res.status).toBe(401);
  });

  it("403 when not owner, admin, or player", async () => {
    const owner = await seedUser("Owner");
    const stranger = await seedUser("Stranger");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: stranger.id } });
    mockCheckEventAdmin.mockResolvedValue(false);
    const res = await getInvites(ctx({ id: ev.id }));
    expect(res.status).toBe(403);
  });

  it("allows owner without admin to list invites (repro cmt7cxlv70001ljsxlbom6ump)", async () => {
    const owner = await seedUser("Owner2");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(false);
    const res = await getInvites(ctx({ id: ev.id }));
    expect(res.status).toBe(200);
  });

  it("returns empty invites when the event has no current game", async () => {
    const owner = await seedUser("Owner");
    const ev = await prisma.event.create({ data: { id: eid(), title: "Game", location: "Pitch", dateTime: new Date(Date.now() + 48 * 3600_000), ownerId: owner.id, maxPlayers: 10 } });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await getInvites(ctx({ id: ev.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invites).toEqual([]);
  });

  it("lists pending invites for the current game", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await getInvites(ctx({ id: ev.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0].eventPlayer.name).toBe(invitee.name);
  });
});

describe("acceptPlayerInvite", () => {
  async function seedInvite(bench = false) {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const maxPlayers = bench ? 1 : 10;
    const ev = await seedEventWithGame(owner.id, new Date(Date.now() + 48 * 3600_000));
    await prisma.event.update({ where: { id: ev.id }, data: { maxPlayers } });
    // Fill the roster to force bench when requested
    if (bench) {
      const filler = await seedUser("Filler");
      await prisma.eventPlayer.create({ data: { eventId: ev.id, name: filler.name, userId: filler.id } });
      await prisma.gameParticipant.create({ data: { gameId: ev.currentGameId, eventPlayerId: (await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: filler.id } })).id, order: 0 } });
    }
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });
    return { owner, invitee, ev, invite };
  }

  it("accepts a pending invite and joins the roster", async () => {
    const { invitee, ev, invite } = await seedInvite();
    const res = await acceptPlayerInvite({ token: invite.token, userId: invitee.id, eventId: ev.id, gameId: ev.currentGameId, maxPlayers: 10 });
    expect(res.status).toBe("accepted");
    expect(res.bench).toBe(false);

    const savedInvite = await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(savedInvite.status).toBe("accepted");
    expect(savedInvite.respondedAt).not.toBeNull();

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    const gp = await prisma.gameParticipant.findFirstOrThrow({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } });
    expect(gp.status).toBe("active");
    const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventPlayerId: ep.id, gameId: ev.currentGameId } });
    expect(rsvp.status).toBe("yes");
    const follow = await prisma.eventFollow.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    expect(follow).toBeTruthy();
  });

  it("sends the invitee to the bench when the roster is full", async () => {
    const { invitee, ev, invite } = await seedInvite(true);
    const res = await acceptPlayerInvite({ token: invite.token, userId: invitee.id, eventId: ev.id, gameId: ev.currentGameId, maxPlayers: 1 });
    expect(res.bench).toBe(true);
    const jobs = await prisma.notificationJob.findMany({ where: { type: "player_joined_bench" } });
    expect(jobs.length).toBeGreaterThan(0);
  });

  it("accepts a pending invite onto the active roster when a slot is free (pending entries excluded from order)", async () => {
    // maxPlayers=2 with one active player → one free slot. A pending invite
    // (order 1) must NOT push the accepting invitee to order 2 / the bench.
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const filler = await seedUser("Filler");
    const maxPlayers = 2;
    const ev = await seedEventWithGame(owner.id, new Date(Date.now() + 48 * 3600_000));
    await prisma.event.update({ where: { id: ev.id }, data: { maxPlayers } });
    const fillerEp = await prisma.eventPlayer.create({ data: { eventId: ev.id, name: filler.name, userId: filler.id } });
    await prisma.gameParticipant.create({ data: { gameId: ev.currentGameId, eventPlayerId: fillerEp.id, order: 0, status: "active" } });

    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    const res = await acceptPlayerInvite({ token: invite.token, userId: invitee.id, eventId: ev.id, gameId: ev.currentGameId, maxPlayers });
    expect(res.bench).toBe(false);

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    const gp = await prisma.gameParticipant.findFirstOrThrow({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } });
    expect(gp.status).toBe("active");
    expect(gp.order).toBeLessThan(maxPlayers);
  });

  it("rejects accepting for the wrong account", async () => {
    const { owner, ev, invite } = await seedInvite();
    await expect(
      acceptPlayerInvite({ token: invite.token, userId: owner.id, eventId: ev.id, gameId: ev.currentGameId, maxPlayers: 10 }),
    ).rejects.toThrow(/not for your account/);
  });

  it("expires invites once kickoff has passed", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id, new Date(Date.now() + 48 * 3600_000));
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });
    // kickoff passes
    await prisma.game.update({ where: { id: ev.currentGameId }, data: { dateTime: new Date(Date.now() - 1000) } });

    const expired = await expirePendingInvites(ev.currentGameId);
    expect(expired).toBe(1);
    const saved = await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(saved.status).toBe("expired");
  });
});

describe("declinePlayerInvite", () => {
  it("marks declined, removes the GameParticipant and records RSVP=no", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    const res = await declinePlayerInvite({ token: invite.token, userId: invitee.id, gameId: ev.currentGameId });
    expect(res.status).toBe("declined");

    const saved = await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(saved.status).toBe("declined");
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    expect(await prisma.gameParticipant.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(0);
    const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } });
    expect(rsvp.status).toBe("no");
    // EventPlayer shell persists
    expect(ep).toBeTruthy();
  });
});

describe("retractPlayerInvite", () => {
  it("cancels a pending invite for the owner", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await retractInvite(deleteCtx({ id: ev.id }, { inviteId: invite.inviteId }));
    expect(res.status).toBe(200);
    const saved = await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(saved.status).toBe("cancelled");
  });

  it("removes the pending GameParticipant + Rsvp ghost so the invitee leaves the invited list", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    expect(await prisma.gameParticipant.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(1);

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await retractInvite(deleteCtx({ id: ev.id }, { inviteId: invite.inviteId }));
    expect(res.status).toBe(200);

    // The pending roster ghost must be gone (regression: a lingering pending
    // GameParticipant re-surfaced the invitee as "Invited" with a null inviteId,
    // so a second remove sent the EventPlayer id and hit "Invite not found.").
    expect(await prisma.gameParticipant.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(0);
    expect(await prisma.rsvp.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(0);
  });

  it("resolves an EventPlayer id (backward-compat) and removes the ghost", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });

    // Pre-fix clients passed invited[].id (EventPlayer id) instead of inviteId.
    const res = await retractInvite(deleteCtx({ id: ev.id }, { inviteId: ep.id }));
    expect(res.status).toBe(200);
    expect(await prisma.gameParticipant.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(0);
    expect(await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } }).then((i) => i.status)).toBe("cancelled");
  });

  it("rejects a random user", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const stranger = await seedUser("Stranger");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: stranger.id } });
    const res = await retractInvite(deleteCtx({ id: ev.id }, { inviteId: invite.inviteId }));
    expect(res.status).toBe(403);
  });

  it("allows an admin (not owner/inviter) to retract an invite", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const admin = await seedUser("Admin");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: admin.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await retractInvite(deleteCtx({ id: ev.id }, { inviteId: invite.inviteId }));
    expect(res.status).toBe(200);
    const saved = await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(saved.status).toBe("cancelled");
  });

  it("401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await retractInvite(deleteCtx({ id: "e-1" }, { inviteId: "i-1" }));
    expect(res.status).toBe(401);
  });

  it("400 on malformed JSON", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await retractInvite(rawCtx({ id: ev.id }, "DELETE"));
    expect(res.status).toBe(400);
  });

  it("400 when inviteId is missing", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await retractInvite(deleteCtx({ id: ev.id }, {}));
    expect(res.status).toBe(400);
  });

  it("400 when retract fails with a non-owner error", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const spy = vi.spyOn(inviteServer, "retractPlayerInvite").mockRejectedValue(new Error("boom"));
    const res = await retractInvite(deleteCtx({ id: ev.id }, { inviteId: "i-1" }));
    expect(res.status).toBe(400);
    spy.mockRestore();
  });
});

describe("GET /api/invite/[token]", () => {
  it("returns pending invite details for the invitee", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: invitee.id } });
    const res = await inviteLookup(ctx({ token: invite.token }));
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.status).toBe("pending");
    expect(body.isInvitee).toBe(true);
    expect(body.game.title).toBe("Game");
    expect(body.inviteeName).toBe(invitee.name);
  });

  it("returns 404 for unknown tokens", async () => {
    const res = await inviteLookup(ctx({ token: "nope" }));
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it("reports isInvitee false for an authenticated stranger", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const stranger = await seedUser("Stranger");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: stranger.id } });
    const res = await inviteLookup(ctx({ token: invite.token }));
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.isInvitee).toBe(false);
    expect(body.authenticated).toBe(true);
  });
});

describe("POST /api/invite/[token] (accept/decline via link)", () => {
  it("accepts via the link", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: invitee.id } });
    const res = await inviteTokenPost(ctx({ token: invite.token }, { action: "accept" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("accepted");
    const saved = await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(saved.status).toBe("accepted");
  });

  it("declines via the link", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: invitee.id } });
    const res = await inviteTokenPost(ctx({ token: invite.token }, { action: "decline" }));
    expect(res.status).toBe(200);
    const saved = await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(saved.status).toBe("declined");
  });

  it("rejects a different authenticated user", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const stranger = await seedUser("Stranger");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: stranger.id } });
    const res = await inviteTokenPost(ctx({ token: invite.token }, { action: "accept" }));
    expect(res.status).toBe(403);
  });

  it("expired invites return 410", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id, new Date(Date.now() - 1000));
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: invitee.id } });
    const res = await inviteTokenPost(ctx({ token: invite.token }, { action: "accept" }));
    expect(res.status).toBe(410);
  });

  it("401 when unauthenticated on a CLAIMED invite", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    // createPlayerInvite links the shell to the invitee ⇒ claimed semantics
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue(null);
    const res = await inviteTokenPost(ctx({ token: invite.token }, { action: "accept" }));
    expect(res.status).toBe(401);
  });

  it("unknown token is 404 even unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await inviteTokenPost(ctx({ token: "t-1" }, { action: "accept" }));
    expect(res.status).toBe(404);
  });

  it("400 on malformed JSON", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: (await seedUser("Invitee")).id, invitedByUserId: owner.id, origin: "https://x.dev" });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await inviteTokenPost(rawCtx({ token: invite.token }));
    expect(res.status).toBe(400);
  });

  it("400 on an invalid action", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    const invitee = await seedUser("Invitee");
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });
    mockGetSession.mockResolvedValue({ user: { id: invitee.id } });
    const res = await inviteTokenPost(ctx({ token: invite.token }, { action: "maybe" }));
    expect(res.status).toBe(400);
  });

  it("404 for an unknown token", async () => {
    const invitee = await seedUser("Invitee");
    mockGetSession.mockResolvedValue({ user: { id: invitee.id } });
    const res = await inviteTokenPost(ctx({ token: "nope" }, { action: "accept" }));
    expect(res.status).toBe(404);
  });

  it("404 when the invite's game is missing", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });
    await prisma.game.deleteMany({ where: { id: ev.currentGameId } });
    mockGetSession.mockResolvedValue({ user: { id: invitee.id } });
    const res = await inviteTokenPost(ctx({ token: invite.token }, { action: "accept" }));
    expect(res.status).toBe(404);
  });

  it("400 when accepting an invite throws server-side", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });
    mockGetSession.mockResolvedValue({ user: { id: invitee.id } });
    const spy = vi.spyOn(inviteServer, "acceptPlayerInvite").mockRejectedValue(new Error("boom"));
    const res = await inviteTokenPost(ctx({ token: invite.token }, { action: "accept" }));
    expect(res.status).toBe(400);
    spy.mockRestore();
  });
});

describe("GET /api/events/[id] — invited roster", () => {
  it("shows pending invites to the owner", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const res = await getEvent(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.invited).toHaveLength(1);
    expect(body.invited[0].name).toBe(invitee.name);
    // Pending entries are NOT in the active roster
    expect(body.players.some((p: { userId: string | null }) => p.userId === invitee.id)).toBe(false);
  });

  it("hides pending invites from anonymous viewers", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    const res = await getEvent(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.invited).toEqual([]);
  });

  it("shows the invitee their own pending entry", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });

    mockGetSession.mockResolvedValue({ user: { id: invitee.id } });
    const res = await getEvent(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.invited).toHaveLength(1);
    expect(body.invited[0].userId).toBe(invitee.id);
  });
});
describe("getInviteChannels — ADR 0025 notification channels", () => {
  it("reports web push when the user has a web subscription and push prefs", async () => {
    const user = await seedUser("ChanWeb");
    await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: `https://ep-${Date.now()}`, p256dh: "x", auth: "y" } });

    const channels = await getInviteChannels(user.id);
    expect(channels.webPush).toBe(true);
    expect(channels.appPush).toBe(false);
    expect(channels.email).toBe(false);
  });

  it("reports app push when the user has an app push token", async () => {
    const user = await seedUser("ChanApp");
    await prisma.appPushToken.create({ data: { userId: user.id, token: `tok-${Date.now()}`, platform: "android", locale: "pt" } });

    const channels = await getInviteChannels(user.id);
    expect(channels.appPush).toBe(true);
  });

  it("never reports email — invites are push-only + share-link (owner decision)", async () => {
    const user = await seedUser("ChanEmail");
    await prisma.notificationPreferences.create({ data: { userId: user.id, emailEnabled: true, gameInviteEmail: true } });
    process.env.RESEND_API_KEY = "test-key";
    try {
      const channels = await getInviteChannels(user.id);
      expect(channels.email).toBe(false);
    } finally {
      delete process.env.RESEND_API_KEY;
    }
  });

  it("does not report email without a verified email", async () => {
    const user = await prisma.user.create({
      data: { id: "u-chan-unverified", name: "ChanUnverified", email: "unver@t.com", emailVerified: false },
    });
    await prisma.notificationPreferences.create({ data: { userId: user.id, emailEnabled: true, gameInviteEmail: true } });
    process.env.RESEND_API_KEY = "test-key";
    try {
      const channels = await getInviteChannels(user.id);
      expect(channels.email).toBe(false);
    } finally {
      delete process.env.RESEND_API_KEY;
    }
  });

  it("returns all false when the global invites kill switch is off", async () => {
    const user = await seedUser("ChanOff");
    await prisma.notificationPreferences.create({ data: { userId: user.id, invitesEnabled: false } });
    await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: `https://ep-${Date.now()}`, p256dh: "x", auth: "y" } });

    const channels = await getInviteChannels(user.id);
    expect(channels).toEqual({ email: false, webPush: false, appPush: false });
  });

  it("never sends an invite email, even when email prefs are on", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    await prisma.notificationPreferences.create({ data: { userId: invitee.id, emailEnabled: true, gameInviteEmail: true } });
    const ev = await seedEventWithGame(owner.id);

    process.env.RESEND_API_KEY = "test-key";
    const spy = vi.spyOn(emailServer, "sendGameInvite").mockResolvedValue(undefined);
    try {
      const res = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });
      expect(spy).not.toHaveBeenCalled();
      expect(res.channels.email).toBe(false);
    } finally {
      spy.mockRestore();
      delete process.env.RESEND_API_KEY;
    }
  });

  it("does not send email when the email channel is disabled", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);

    process.env.RESEND_API_KEY = "test-key";
    const spy = vi.spyOn(emailServer, "sendGameInvite").mockResolvedValue(undefined);
    try {
      const res = await createPlayerInvite({ eventId: ev.id, gameId: ev.currentGameId, inviteeUserId: invitee.id, invitedByUserId: owner.id, origin: "https://x.dev" });
      expect(spy).not.toHaveBeenCalled();
      expect(res.channels.email).toBe(false);
    } finally {
      spy.mockRestore();
      delete process.env.RESEND_API_KEY;
    }
  });

  it("returns the channels in the POST /invites response", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    await prisma.appPushToken.create({ data: { userId: invitee.id, token: `tok-${Date.now()}`, platform: "android", locale: "en" } });
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(true);

    const res = await createInvite(ctx({ id: ev.id }, { userId: invitee.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channels).toEqual({ email: false, webPush: false, appPush: true });
  });
});
