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
import { createPlayerInvite, acceptPlayerInvite, declinePlayerInvite, expirePendingInvites } from "~/lib/invite.server";
import * as inviteServer from "~/lib/invite.server";

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

  it("403 when not an admin", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    mockCheckEventAdmin.mockResolvedValue(false);
    const res = await getInvites(ctx({ id: ev.id }));
    expect(res.status).toBe(403);
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
  it("marks declined and removes GameParticipant + Rsvp", async () => {
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
    expect(await prisma.rsvp.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(0);
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

  it("401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await inviteTokenPost(ctx({ token: "t-1" }, { action: "accept" }));
    expect(res.status).toBe(401);
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