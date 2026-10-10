import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { createPlayerInvite } from "~/lib/invite.server";

function ctx(eventId: string, inviteToken?: string) {
  const url = inviteToken
    ? `http://localhost/api/events/${eventId}?inviteToken=${inviteToken}`
    : `http://localhost/api/events/${eventId}`;
  return {
    params: { id: eventId },
    request: new Request(url, {
      headers: { cookie: "" },
    }),
  } as any;
}

async function seedUser(name: string, email: string) {
  return prisma.user.create({
    data: {
      id: `u-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      name,
      email,
      emailVerified: true,
    },
  });
}

async function seedEventAt(ownerId: string | null, dateTime: Date) {
  const event = await prisma.event.create({
    data: {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: "Test Event",
      location: "Test Field",
      dateTime,
      timezone: "UTC",
      maxPlayers: 10,
      ownerId,
      accessPassword: "secret123",
      currentGameId: null,
    },
  });
  const game = await prisma.game.create({
    data: {
      id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      eventId: event.id,
      dateTime,
      status: "scheduled",
    },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id, gameId: game.id };
}

async function seedEvent(ownerId: string | null) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return seedEventAt(ownerId, tomorrow);
}

describe("GET /api/events/[id] — inviteToken bypass", () => {
  beforeEach(async () => {
    await prisma.playerInvite.deleteMany();
    await prisma.gameParticipant.deleteMany();
    await prisma.eventPlayer.deleteMany();
    await prisma.game.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    await prisma.account.deleteMany();
  });

  it("bypasses password lock when a valid inviteToken for this event is provided", async () => {
    const owner = await seedUser("Owner", "owner@example.com");
    const invitee = await seedUser("Invitee", "invitee@example.com");
    const event = await seedEvent(owner.id);

    const { token } = await createPlayerInvite({
      eventId: event.id,
      gameId: event.gameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://convocados.cabeda.dev",
    });

    // Without token, password-locked event should be locked for anonymous
    const lockedRes = await getEvent(ctx(event.id));
    const lockedBody = await lockedRes.json();
    expect(lockedBody.locked).toBe(true);

    // With valid token, should bypass and return the event
    const bypassRes = await getEvent(ctx(event.id, token));
    const bypassBody = await bypassRes.json();
    expect(bypassBody.locked).toBeUndefined();
    expect(bypassBody.id).toBe(event.id);
  });

  it("does not bypass when token is for a different event", async () => {
    const owner = await seedUser("Owner2", "owner2@example.com");
    const invitee = await seedUser("Invitee2", "invitee2@example.com");
    const eventA = await seedEvent(owner.id);
    const eventB = await seedEvent(owner.id);

    const { token } = await createPlayerInvite({
      eventId: eventA.id,
      gameId: eventA.gameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://convocados.cabeda.dev",
    });

    // Token for eventA should not bypass eventB
    const res = await getEvent(ctx(eventB.id, token));
    const body = await res.json();
    expect(body.locked).toBe(true);
  });

  it("refuses the password bypass once the invite's game has kicked off", async () => {
    const owner = await seedUser("OwnerPast", "owner-past@example.com");
    const invitee = await seedUser("InviteePast", "invitee-past@example.com");
    const event = await seedEventAt(owner.id, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    const { token } = await createPlayerInvite({
      eventId: event.id,
      gameId: event.gameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://convocados.cabeda.dev",
    });

    const res = await getEvent(ctx(event.id, token));
    const body = await res.json();

    expect(body.locked).toBe(true);
    expect(body.hasPassword).toBe(true);
    // The lock payload carries no dead "inviteExpired" hint — nothing reads it.
    expect(body.inviteExpired).toBeUndefined();
    // Anonymous viewer of a stale token sees the lock, never the roster.
    expect(body.players).toBeUndefined();
    expect(body.teamResults).toBeUndefined();
    expect(body.title).toBe("Test Event");
  });

  it("heals the stale invite to expired and drops the pending roster ghost", async () => {
    const owner = await seedUser("OwnerHeal", "owner-heal@example.com");
    const invitee = await seedUser("InviteeHeal", "invitee-heal@example.com");
    const event = await seedEventAt(owner.id, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const { token } = await createPlayerInvite({
      eventId: event.id,
      gameId: event.gameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://convocados.cabeda.dev",
    });

    expect(await prisma.gameParticipant.count({ where: { gameId: event.gameId, status: "pending" } })).toBe(1);

    await getEvent(ctx(event.id, token));

    const invite = await prisma.playerInvite.findUniqueOrThrow({ where: { token } });
    expect(invite.status).toBe("expired");
    expect(await prisma.gameParticipant.count({ where: { gameId: event.gameId, status: "pending" } })).toBe(0);
    expect(await prisma.rsvp.count({ where: { gameId: event.gameId } })).toBe(0);
  });

  it("refuses an already-answered token for a past game without rewriting it", async () => {
    const owner = await seedUser("OwnerDeclined", "owner-declined@example.com");
    const invitee = await seedUser("InviteeDeclined", "invitee-declined@example.com");
    const event = await seedEventAt(owner.id, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const { token } = await createPlayerInvite({
      eventId: event.id,
      gameId: event.gameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://convocados.cabeda.dev",
    });
    await prisma.playerInvite.update({ where: { token }, data: { status: "declined" } });

    const res = await getEvent(ctx(event.id, token));
    const body = await res.json();

    expect(body.locked).toBe(true);
    const invite = await prisma.playerInvite.findUniqueOrThrow({ where: { token } });
    expect(invite.status).toBe("declined");
  });

  it("keeps the password bypass for an accepted invite on a game already played", async () => {
    const owner = await seedUser("OwnerAccPast", "owner-accpast@example.com");
    const invitee = await seedUser("InviteeAccPast", "invitee-accpast@example.com");
    const event = await seedEventAt(owner.id, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const { token } = await createPlayerInvite({
      eventId: event.id,
      gameId: event.gameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://convocados.cabeda.dev",
    });
    await prisma.playerInvite.update({ where: { token }, data: { status: "accepted" } });

    const res = await getEvent(ctx(event.id, token));
    const body = await res.json();

    // An accepted invite means this person played that occurrence — the token
    // must not be revoked just because the game has kicked off.
    expect(body.locked).toBeUndefined();
    expect(body.id).toBe(event.id);
    // …and the answer is never rewritten into an expiry.
    const invite = await prisma.playerInvite.findUniqueOrThrow({ where: { token } });
    expect(invite.status).toBe("accepted");
  });

  it("does not gate the bypass when the invite's game row is gone", async () => {
    const owner = await seedUser("OwnerNoGame", "owner-nogame@example.com");
    const invitee = await seedUser("InviteeNoGame", "invitee-nogame@example.com");
    const event = await seedEvent(owner.id);

    const { token } = await createPlayerInvite({
      eventId: event.id,
      gameId: event.gameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://convocados.cabeda.dev",
    });

    // Some SQLite deployments run with foreign keys off, so a PlayerInvite can
    // outlive its Game. Re-point the FK at a game that does not exist to model
    // that, then restore enforcement so the rest of the suite keeps its
    // cascade-on-delete behaviour.
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE PlayerInvite SET gameId = 'missing-game-for-token' WHERE token = '${token}'`,
      );
    } finally {
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    }

    const res = await getEvent(ctx(event.id, token));
    const body = await res.json();

    // A missing game is not an expiry: the gate must stay out of the way
    // exactly as it does on main, where the game was only consulted for
    // the event match.
    expect(body.locked).toBeUndefined();
    expect(body.id).toBe(event.id);
  });

  it("still bypasses the password for an accepted invite on a game yet to kick off", async () => {
    const owner = await seedUser("OwnerAccepted", "owner-accepted@example.com");
    const invitee = await seedUser("InviteeAccepted", "invitee-accepted@example.com");
    const event = await seedEvent(owner.id);

    const { token } = await createPlayerInvite({
      eventId: event.id,
      gameId: event.gameId,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://convocados.cabeda.dev",
    });
    await prisma.playerInvite.update({ where: { token }, data: { status: "accepted" } });

    const res = await getEvent(ctx(event.id, token));
    const body = await res.json();

    expect(body.locked).toBeUndefined();
    expect(body.id).toBe(event.id);
  });
});
