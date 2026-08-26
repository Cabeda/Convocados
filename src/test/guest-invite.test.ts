/**
 * Guest invite links (dex follow-up): anonymous players ("Manecas") have no
 * account, so they could only be added to the roster — never invited. This
 * spec pins the guest-link flow:
 *
 *   POST /invites { name, deliver:false }  → anonymous EventPlayer shell +
 *   pending participant + pending PlayerInvite token (always silent — guests
 *   have no channel). The inviter shares the /invite/<token> URL; the first
 *   accepting while logged in CLAIMS the row; anonymous acceptance leaves it
 *   unclaimed for a later bind (ADR 0026).
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
import { GET as inviteLookup, POST as inviteTokenPost } from "~/pages/api/invite/[token]";
import { POST as claimPlayerPost } from "~/pages/api/events/[id]/claim-player";

function req(params: Record<string, string>, body?: unknown, method?: string) {
  const request = new Request("http://localhost/api/test", {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  await prisma.gameHistory.deleteMany();
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

describe("guest invite links", () => {
  it("creates a silent pending invite for an anonymous player by name", async () => {
    const { owner, event, gameId } = await seedOwnerAndEvent();

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await createInviteRoute(req({ id: event.id }, { name: "Manecas" }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.inviteUrl).toContain("/invite/");

    // Anonymous shell, not linked to any account
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Manecas" } });
    expect(ep.userId).toBeNull();

    const invite = await prisma.playerInvite.findFirstOrThrow({});
    expect(invite.eventPlayerId).toBe(ep.id);
    expect(invite.status).toBe("pending");
    expect(invite.notifiedAt).toBeNull(); // always silent for guests

    const gp = await prisma.gameParticipant.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
    });
    expect(gp.status).toBe("pending");
  });

  it("re-inviting reuses the same anonymous row and invite slot", async () => {
    const { owner, event } = await seedOwnerAndEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });

    await createInviteRoute(req({ id: event.id }, { name: "Manecas" }));
    const second = await createInviteRoute(req({ id: event.id }, { name: "Manecas" }));
    expect(second.status).toBe(200);

    expect(await prisma.eventPlayer.count({ where: { eventId: event.id, name: "Manecas" } })).toBe(1);
    expect(await prisma.playerInvite.count({})).toBe(1); // unique(gameId, eventPlayerId) upserted
    // Re-invite flips the row back to a live pending state with a fresh URL
    const json = await second.json();
    expect(json.inviteUrl).toContain("/invite/");
  });

  it("lookup marks the token claimable and acceptance claims the account", async () => {
    const { owner, event, gameId } = await seedOwnerAndEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const created = await createInviteRoute(req({ id: event.id }, { name: "Manecas" }));
    const { inviteUrl } = await created.json();
    const token = (inviteUrl as string).split("/invite/")[1];

    // Public lookup: valid, pending, nobody is "the invitee" yet
    const lookup = await inviteLookup(req({ token }));
    const body = await lookup.json();
    expect(body.valid).toBe(true);
    expect(body.status).toBe("pending");
    expect(body.claimable).toBe(true);

    // Accepting while logged in claims the anonymous player
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const accepted = await inviteTokenPost(req({ token }, { action: "accept" }));
    expect(accepted.status).toBe(200);

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Manecas" } });
    expect(ep.userId).toBe(owner.id);
    const invite = await prisma.playerInvite.findFirstOrThrow({});
    expect(invite.status).toBe("accepted");
    const gp = await prisma.gameParticipant.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
    });
    expect(gp.status).toBe("active");
  });
});

describe("frictionless guest acceptance (no account)", () => {
  async function seedGuestInvite() {
    const { owner, event, gameId } = await seedOwnerAndEvent();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await createInviteRoute(req({ id: event.id }, { name: "Manecas" }));
    const { inviteUrl } = await res.json();
    const token = (inviteUrl as string).split("/invite/")[1];
    return { owner, event, gameId, token };
  }

  it("unauthenticated visitor can ACCEPT — roster active, no account bound", async () => {
    const { event, gameId, token } = await seedGuestInvite();
    mockGetSession.mockResolvedValue(null); // anonymous visitor

    const res = await inviteTokenPost(req({ token }, { action: "accept" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bench).toBe(false);

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Manecas" } });
    expect(ep.userId).toBeNull();
    const invite = await prisma.playerInvite.findFirstOrThrow({});
    expect(invite.status).toBe("accepted");
    const gp = await prisma.gameParticipant.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
    });
    expect(gp.status).toBe("active");
  });

  it("unauthenticated visitor can DECLINE", async () => {
    const { event, gameId, token } = await seedGuestInvite();
    mockGetSession.mockResolvedValue(null);

    const res = await inviteTokenPost(req({ token }, { action: "decline" }));
    expect(res.status).toBe(200);

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Manecas" } });
    const invite = await prisma.playerInvite.findFirstOrThrow({});
    expect(invite.status).toBe("declined");
    expect(await prisma.gameParticipant.count({ where: { gameId, eventPlayerId: ep.id } })).toBe(0);
    const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { eventPlayerId: ep.id } });
    expect(rsvp.status).toBe("no");
  });

  it("answer is immutable until the organizer retracts", async () => {
    const { token } = await seedGuestInvite();
    mockGetSession.mockResolvedValue(null);

    await inviteTokenPost(req({ token }, { action: "accept" }));
    const second = await inviteTokenPost(req({ token }, { action: "decline" }));
    expect(second.status).toBe(409);
    const json = await second.json();
    expect(json.error).toMatch(/no longer pending/i);
  });

  it("claimed tokens stay account-bound: no session → 401", async () => {
    const { owner, event } = await seedOwnerAndEvent();
    // Registered-target invite (email path) — claimed semantics
    const luis = await prisma.user.create({
      data: { id: `u-luis-${Math.random().toString(36).slice(2, 6)}`, name: "Luís Lopes", email: "luis@t.com", emailVerified: true },
    });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    await createInviteRoute(req({ id: event.id }, { userId: luis.id }));

    mockGetSession.mockResolvedValue(null);
    const res = await inviteTokenPost(req({ token: (await prisma.playerInvite.findFirstOrThrow({})).token }, { action: "accept" }));
    expect(res.status).toBe(401);
  });

  it("logged-in user can join as the GUEST explicitly without binding their account", async () => {
    const { owner, event, gameId, token } = await seedGuestInvite();
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });

    const res = await inviteTokenPost(req({ token }, { action: "accept", asGuest: true }));
    expect(res.status).toBe(200);

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Manecas" } });
    expect(ep.userId).toBeNull(); // NOT claimed
    const gp = await prisma.gameParticipant.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
    });
    expect(gp.status).toBe("active");
  });

  it("guest accept on a full roster lands on the bench", async () => {
    const { event, gameId, token } = await seedGuestInvite();
    await prisma.event.update({ where: { id: event.id }, data: { maxPlayers: 1 } });
    // Fill the single spot
    const filler = await prisma.user.create({
      data: { id: `u-f-${Math.random().toString(36).slice(2, 6)}`, name: "Filler", email: "f@t.com", emailVerified: true },
    });
    const fep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Filler", userId: filler.id } });
    await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: fep.id, order: 0, status: "active" } });

    mockGetSession.mockResolvedValue(null);
    const res = await inviteTokenPost(req({ token }, { action: "accept" }));
    expect(res.status).toBe(200);
    expect((await res.json()).bench).toBe(true);

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Manecas" } });
    const gp = await prisma.gameParticipant.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
    });
    expect(gp.status).toBe("active");
    expect(gp.order).toBeGreaterThanOrEqual(1);
  });

  it("lookup exposes viewerName + claim target for the dual-choice page", async () => {
    const { owner, token } = await seedGuestInvite();
    mockGetSession.mockResolvedValue({ user: { id: owner.id, name: owner.name } });

    const res = await inviteLookup(req({ token }));
    const body = await res.json();
    expect(body.claimable).toBe(true);
    expect(body.viewerName).toBe(owner.name);
    expect(body.claimPlayerId).toBeTruthy();
    expect(body.inviteeName).toBe("Manecas");
  });
});

describe("binding an accepted guest row to an account", () => {
  async function seedAcceptedGuest() {
    const { owner, event, gameId, token } = await (async () => {
      const s = await seedOwnerAndEvent();
      mockGetSession.mockResolvedValue({ user: { id: s.owner.id } });
      const res = await createInviteRoute(req({ id: s.event.id }, { name: "Manecas" }));
      const { inviteUrl } = await res.json();
      return { ...s, token: (inviteUrl as string).split("/invite/")[1] };
    })();
    mockGetSession.mockResolvedValue(null);
    await inviteTokenPost(req({ token }, { action: "accept" }));
    return { owner, event, gameId };
  }

  it("claim-player binds the anonymous EventPlayer to the signed-in account", async () => {
    const { owner, event, gameId } = await seedAcceptedGuest();
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Manecas" } });

    mockGetSession.mockResolvedValue({ user: { id: owner.id, name: owner.name } });
    const res = await claimPlayerPost(req({ id: event.id }, { playerId: ep.id }));
    expect(res.status).toBe(200);

    const bound = await prisma.eventPlayer.findUniqueOrThrow({ where: { id: ep.id } });
    expect(bound.userId).toBe(owner.id);
    expect(bound.name).toBe(owner.name);
    // Roster membership survives the bind and stays active for the current game
    const gp = await prisma.gameParticipant.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
    });
    expect(gp.status).toBe("active");
    // Follow created
    expect(await prisma.eventFollow.count({ where: { eventId: event.id, userId: owner.id } })).toBe(1);
  });

  it("refuses when the viewer already has a linked row in the event", async () => {
    const { owner, event } = await seedAcceptedGuest();
    // Owner already linked as a different player row
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: owner.name, userId: owner.id } });
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Manecas" } });

    mockGetSession.mockResolvedValue({ user: { id: owner.id, name: owner.name } });
    const res = await claimPlayerPost(req({ id: event.id }, { playerId: ep.id }));
    expect(res.status).toBe(409);
  });
});
