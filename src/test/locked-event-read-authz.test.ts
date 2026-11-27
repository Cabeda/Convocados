import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { buildAccessCookie } from "~/lib/eventAccess";

import { GET as knownPlayers } from "~/pages/api/events/[id]/known-players";
import { GET as attendance } from "~/pages/api/events/[id]/attendance";
import { GET as guests } from "~/pages/api/events/[id]/rsvp/guests";

/**
 * A password-locked Event answers anonymous reads for its roster, attendance and
 * RSVP state exactly as it answers the main payload: locked, no roster. Account
 * userIds and follower identities stay with owner/admin/invited callers.
 */

const ACCESS_PASSWORD = "locked-event-password-hash";

let ownerId = "";
let adminUserId = "";
let inviteeUserId = "";
let ownerToken = "";
let adminToken = "";
let inviteeToken = "";

async function seedUserWithToken(prefix: string) {
  const userId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.user.create({
    data: { id: userId, name: prefix, email: `${userId}@test.com`, emailVerified: false },
  });
  const clientId = `client-${userId}`;
  await prisma.oauthClient.create({
    data: { id: clientId, clientId, redirectUris: "https://example.com/callback" },
  });
  const token = `tok-${userId}`;
  await prisma.oauthAccessToken.create({
    data: { id: `at-${userId}`, token, clientId, userId, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { userId, token };
}

function ctx(eventId: string, opts: { token?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  const request = new Request(`http://localhost/api/events/${eventId}/read`, { headers });
  return { request, params: { id: eventId }, url: new URL(request.url) } as any;
}

async function seedLockedEvent() {
  const event = await prisma.event.create({
    data: {
      title: "Locked Event",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
      ownerId,
      accessPassword: ACCESS_PASSWORD,
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

  const linked = await prisma.eventPlayer.create({
    data: { eventId: event.id, name: "Linked Player", gamesPlayed: 3, userId: inviteeUserId },
  });
  const guest = await prisma.eventPlayer.create({
    data: { eventId: event.id, name: "Guest Player", gamesPlayed: 1 },
  });
  await prisma.player.create({
    data: { eventId: event.id, name: "Guest Player", order: 0 },
  });
  await prisma.rsvp.create({
    data: { eventPlayerId: guest.id, gameId: game.id, status: "yes", respondedAt: new Date() },
  });
  await prisma.eventFollow.create({ data: { eventId: event.id, userId: inviteeUserId } });
  await prisma.gameHistory.create({
    data: {
      eventId: event.id,
      dateTime: new Date(Date.now() - 86_400_000),
      status: "played",
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      teamsSnapshot: JSON.stringify([
        { team: "Ninjas", players: [{ name: linked.name, order: 0 }] },
        { team: "Gunas", players: [{ name: guest.name, order: 0 }] },
      ]),
    },
  });

  return { event, linked, guest };
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.rsvp.deleteMany();
  await prisma.eventInvite.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  ({ userId: ownerId, token: ownerToken } = await seedUserWithToken("owner"));
  ({ userId: adminUserId, token: adminToken } = await seedUserWithToken("admin"));
  ({ userId: inviteeUserId, token: inviteeToken } = await seedUserWithToken("invitee"));
});

describe("a password-locked Event hides its roster sub-resources from anonymous callers", () => {
  it("denies anonymous known-players", async () => {
    const { event } = await seedLockedEvent();
    const res = await knownPlayers(ctx(event.id));
    expect(res.status).toBe(403);
    expect((await res.json()).locked).toBe(true);
  });

  it("denies anonymous attendance", async () => {
    const { event } = await seedLockedEvent();
    const res = await attendance(ctx(event.id));
    expect(res.status).toBe(403);
    expect((await res.json()).locked).toBe(true);
  });

  it("denies anonymous rsvp/guests", async () => {
    const { event } = await seedLockedEvent();
    const res = await guests(ctx(event.id));
    expect(res.status).toBe(403);
    expect((await res.json()).locked).toBe(true);
  });
});

describe("a password-locked Event still serves privileged callers", () => {
  it("lets the owner read known-players with account userIds", async () => {
    const { event } = await seedLockedEvent();
    const res = await knownPlayers(ctx(event.id, { token: ownerToken }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const linked = body.players.find((p: any) => p.name === "Linked Player");
    expect(linked.userId).toBe(inviteeUserId);
  });

  it("lets an event admin read known-players with account userIds", async () => {
    const { event } = await seedLockedEvent();
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: adminUserId } });
    const res = await knownPlayers(ctx(event.id, { token: adminToken }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const linked = body.players.find((p: any) => p.name === "Linked Player");
    expect(linked.userId).toBe(inviteeUserId);
  });

  it("lets an invitee read known-players with account userIds", async () => {
    const { event } = await seedLockedEvent();
    await prisma.eventInvite.create({ data: { eventId: event.id, userId: inviteeUserId } });
    const res = await knownPlayers(ctx(event.id, { token: inviteeToken }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const linked = body.players.find((p: any) => p.name === "Linked Player");
    expect(linked.userId).toBe(inviteeUserId);
  });

  it("lets the owner read attendance and rsvp/guests", async () => {
    const { event } = await seedLockedEvent();
    expect((await attendance(ctx(event.id, { token: ownerToken }))).status).toBe(200);
    expect((await guests(ctx(event.id, { token: ownerToken }))).status).toBe(200);
  });

  it("admits a caller holding the password's access cookie but withholds account userIds", async () => {
    const { event } = await seedLockedEvent();
    const res = await knownPlayers(
      ctx(event.id, { cookie: buildAccessCookie(null, event.id, ACCESS_PASSWORD) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.players.map((p: any) => p.name)).toContain("Linked Player");
    expect(body.players.find((p: any) => p.name === "Linked Player").userId).toBeNull();
  });
});
