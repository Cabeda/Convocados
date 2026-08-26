/**
 * Guest invite links (dex follow-up): anonymous players ("Manecas") have no
 * account, so they could only be added to the roster — never invited. This
 * spec pins the guest-link flow:
 *
 *   POST /invites { name, deliver:false }  → anonymous EventPlayer shell +
 *   pending participant + pending PlayerInvite token (always silent — guests
 *   have no channel). The inviter shares the /invite/<token> URL; the first
 *   logged-in user who accepts CLAIMS the EventPlayer row
 *   (EventPlayer.userId = accepter) and joins as that player.
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
