/**
 * Invite ghost lifecycle + suggestion identity consistency.
 *
 * Regression coverage for the prod incident where pending GameParticipants
 * outlived their PlayerInvite ("Invite not found or no longer pending." on
 * retract, immortal "Invited" chips) and co-play suggestions dropped
 * account-linked players whose historical EventPlayer rows were anonymous.
 *
 * Invariant under test (ADR 0025): a pending GameParticipant MUST always have
 * a pending PlayerInvite on the same game. Any read/writer that observes the
 * invariant broken heals it instead of rendering an unremovable invitee.
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
vi.mock("~/lib/geocode", () => ({ resolveLocation: vi.fn() }));

import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { DELETE as retractInvite } from "~/pages/api/events/[id]/invites";
import { POST as inviteTokenPost } from "~/pages/api/invite/[token]";
import { GET as getSuggestions } from "~/pages/api/events/[id]/suggestions";
import { createPlayerInvite, expirePendingInvites } from "~/lib/invite.server";

function ctx(params: Record<string, string>, body?: unknown, method?: string) {
  const request = new Request("http://localhost/api/test", {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

function eid() {
  return `e-${Math.random().toString(36).slice(2, 8)}`;
}

async function seedUser(name: string, overrides: Partial<{ email: string }> = {}) {
  return prisma.user.create({
    data: {
      id: `u-${name}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      email: overrides.email ?? `${name.replace(/\s+/g, ".")}@t.com`,
      emailVerified: true,
    },
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

async function invitedViaPayload(eventId: string) {
  const res = await getEvent(ctx({ id: eventId }));
  const body = await res.json();
  return body.invited as Array<{ id: string; inviteId: string | null; name: string }>;
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

describe("invite ghost lifecycle", () => {
  it("expirePendingInvites removes the pending GameParticipant + Rsvp ghosts", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({
      eventId: ev.id,
      gameId: ev.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://x.dev",
    });

    // kickoff passes; expiry runs (GET /invites or /invite/<token> read path)
    await prisma.game.update({ where: { id: ev.currentGameId }, data: { dateTime: new Date(Date.now() - 1000) } });
    expect(await expirePendingInvites(ev.currentGameId)).toBe(1);

    const saved = await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(saved.status).toBe("expired");

    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    expect(await prisma.gameParticipant.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(0);

    // Owner no longer sees the expired invitee as "Invited"
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const listed = await invitedViaPayload(ev.id);
    expect(listed.map((i) => i.name)).not.toContain(invitee.name);
  });

  it("token-page expiry after kickoff cleans the ghost too", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id);
    const invite = await createPlayerInvite({
      eventId: ev.id,
      gameId: ev.currentGameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://x.dev",
    });

    await prisma.game.update({ where: { id: ev.currentGameId }, data: { dateTime: new Date(Date.now() - 1000) } });
    mockGetSession.mockResolvedValue({ user: { id: invitee.id } });
    const res = await inviteTokenPost(ctx({ token: invite.token }, { action: "accept" }));
    expect(res.status).toBe(410);

    const saved = await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(saved.status).toBe("expired");
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    expect(await prisma.gameParticipant.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(0);
  });

  it("event payload self-heals orphaned pending participants and excludes them from invited[]", async () => {
    const owner = await seedUser("Owner");
    const luis = await seedUser("Luís Lopes");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });

    // Prod-shaped ghost: pending participant whose PlayerInvite vanished
    const ep = await prisma.eventPlayer.create({ data: { eventId: ev.id, name: luis.name, userId: luis.id } });
    await prisma.gameParticipant.create({ data: { gameId: ev.currentGameId, eventPlayerId: ep.id, order: 0, status: "pending" } });

    const listed = await invitedViaPayload(ev.id);
    expect(listed.map((i) => i.name)).not.toContain(luis.name);
    expect(await prisma.gameParticipant.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(0);
  });

  it("retracting an already-orphaned invite cleans the ghost instead of erroring", async () => {
    const owner = await seedUser("Owner");
    const luis = await seedUser("Luís Lopes");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });

    // Invite was cancelled/expired by another writer but the participant ghost stayed
    const ep = await prisma.eventPlayer.create({ data: { eventId: ev.id, name: luis.name, userId: luis.id } });
    await prisma.playerInvite.create({
      data: { gameId: ev.currentGameId, eventPlayerId: ep.id, invitedByUserId: owner.id, status: "cancelled", token: `tok-${ep.id}`, notifiedAt: new Date() },
    });
    await prisma.gameParticipant.create({ data: { gameId: ev.currentGameId, eventPlayerId: ep.id, order: 0, status: "pending" } });

    // Client falls back to sending the EventPlayer id (inviteId was null in the payload)
    const res = await retractInvite(ctx({ id: ev.id }, { inviteId: ep.id }, "DELETE"));
    expect(res.status).toBe(200);
    expect(await prisma.playerInvite.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(1); // record kept, status untouched
    expect(await prisma.gameParticipant.count({ where: { gameId: ev.currentGameId, eventPlayerId: ep.id } })).toBe(0);
  });

  it("retract still fails when neither invite nor ghost exists", async () => {
    const owner = await seedUser("Owner");
    const stranger = await seedUser("Stranger");
    const ev = await seedEventWithGame(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });

    const res = await retractInvite(ctx({ id: ev.id }, { inviteId: stranger.id }, "DELETE"));
    expect(res.status).toBe(400);
  });
});

describe("suggestions identity resolution", () => {
  async function seedCoPlayHistory(
    inviterId: string,
    candidateEpName: string,
    candidateUserId: string | null,
    games = 3,
  ) {
    const inviter = await prisma.user.findUniqueOrThrow({ where: { id: inviterId } });
    const histEv = await seedEventWithGame(null, new Date(Date.now() - 7 * 86_400_000));
    const inviterEp = await prisma.eventPlayer.create({ data: { eventId: histEv.id, name: inviter.name, userId: inviter.id } });
    const candEp = await prisma.eventPlayer.create({ data: { eventId: histEv.id, name: candidateEpName, userId: candidateUserId } });
    for (let i = 0; i < games; i++) {
      const g = await prisma.game.create({
        data: { eventId: histEv.id, dateTime: new Date(Date.now() - (i + 1) * 7 * 86_400_000), status: "played" },
      });
      await prisma.gameParticipant.createMany({
        data: [
          { gameId: g.id, eventPlayerId: inviterEp.id, order: 0, status: "active" },
          { gameId: g.id, eventPlayerId: candEp.id, order: 1, status: "active" },
        ],
      });
    }
  }

  it("suggests account-linked candidates from linked history (control)", async () => {
    const owner = await seedUser("Owner");
    const luis = await seedUser("Luís Lopes");
    const ev = await seedEventWithGame(owner.id);
    await seedCoPlayHistory(owner.id, luis.name, luis.id);

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await getSuggestions(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.suggestions.map((s: { userId: string }) => s.userId)).toContain(luis.id);
  });

  it("recovers candidates whose history rows predate account linking (name match)", async () => {
    const owner = await seedUser("Owner");
    const luis = await seedUser("Luís Lopes");
    const ev = await seedEventWithGame(owner.id);
    // History recorded under an anonymous twin of the same human
    await seedCoPlayHistory(owner.id, "Luís Lopes", null);

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await getSuggestions(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.suggestions.map((s: { userId: string }) => s.userId)).toContain(luis.id);
  });

  it("matches accent/case name variants via normalized unique match", async () => {
    const owner = await seedUser("Owner");
    const luis = await seedUser("Luís Lopes");
    const ev = await seedEventWithGame(owner.id);
    await seedCoPlayHistory(owner.id, "luis lopes", null);

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await getSuggestions(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.suggestions.map((s: { userId: string }) => s.userId)).toContain(luis.id);
  });

  it("never resolves to a system ledger placeholder user", async () => {
    const owner = await seedUser("Owner");
    const tf = await prisma.user.create({
      data: { id: `system:${eid()}:TF`, name: "TF", email: "tf@system.local", emailVerified: false },
    });
    const ev = await seedEventWithGame(owner.id);
    await seedCoPlayHistory(owner.id, "TF", null);

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await getSuggestions(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.suggestions.map((s: { userId: string }) => s.userId)).not.toContain(tf.id);
    expect(body.suggestions).toEqual([]);
  });

  it("leaves unmatched guests out of suggestions (no notification channel exists)", async () => {
    const owner = await seedUser("Owner");
    const ev = await seedEventWithGame(owner.id);
    await seedCoPlayHistory(owner.id, "Mystery Guest", null);

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await getSuggestions(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.suggestions).toEqual([]);
  });

  it("excludes candidates who declined the current game", async () => {
    const owner = await seedUser("Owner");
    const luis = await seedUser("Luís Lopes");
    const ev = await seedEventWithGame(owner.id);
    await seedCoPlayHistory(owner.id, luis.name, luis.id);
    const thisEp = await prisma.eventPlayer.create({ data: { eventId: ev.id, name: luis.name, userId: luis.id } });
    await prisma.rsvp.create({ data: { gameId: ev.currentGameId, eventPlayerId: thisEp.id, status: "no", respondedAt: new Date() } });

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await getSuggestions(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.suggestions.map((s: { userId: string }) => s.userId)).not.toContain(luis.id);
  });

  it("excludes candidates with invites globally disabled", async () => {
    const owner = await seedUser("Owner");
    const luis = await seedUser("Luís Lopes");
    const ev = await seedEventWithGame(owner.id);
    await seedCoPlayHistory(owner.id, luis.name, luis.id);
    await prisma.notificationPreferences.create({ data: { userId: luis.id, invitesEnabled: false } });

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await getSuggestions(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.suggestions.map((s: { userId: string }) => s.userId)).not.toContain(luis.id);
  });

  it("excludes candidates with a pending invite on the current game", async () => {
    const owner = await seedUser("Owner");
    const luis = await seedUser("Luís Lopes");
    const ev = await seedEventWithGame(owner.id);
    await seedCoPlayHistory(owner.id, luis.name, luis.id);
    const thisEp = await prisma.eventPlayer.create({ data: { eventId: ev.id, name: luis.name, userId: luis.id } });
    await prisma.playerInvite.create({
      data: { gameId: ev.currentGameId, eventPlayerId: thisEp.id, invitedByUserId: owner.id, status: "pending", token: `tok-${thisEp.id}`, notifiedAt: new Date() },
    });

    mockGetSession.mockResolvedValue({ user: { id: owner.id } });
    const res = await getSuggestions(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.suggestions.map((s: { userId: string }) => s.userId)).not.toContain(luis.id);
  });
});
