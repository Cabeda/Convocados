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

async function seedEvent(ownerId: string | null) {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const event = await prisma.event.create({
    data: {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: "Test Event",
      location: "Test Field",
      dateTime: tomorrow,
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
      dateTime: tomorrow,
      status: "scheduled",
    },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id, gameId: game.id };
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
});
