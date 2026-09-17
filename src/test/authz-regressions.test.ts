import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

import { POST as randomize } from "~/pages/api/events/[id]/randomize";
import { POST as calendarToken } from "~/pages/api/me/calendar-token";
import { PUT as settleShare } from "~/pages/api/events/[id]/payments/settlement";

/**
 * Regression coverage for the authorization fail-open (ownerless events) and
 * the unauthenticated route fixes. See ADR 0034-era security review.
 */

let ownerId = "";
let otherUserId = "";
let ownerToken = "";
let otherToken = "";

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
    data: {
      id: `at-${userId}`,
      token,
      clientId,
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return { userId, token };
}

async function seedEvent(ownerId: string | null, playerNames: string[] = []) {
  const event = await prisma.event.create({
    data: {
      title: "Authz Event",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId,
    },
  });
  let order = 0;
  for (const name of playerNames) {
    await prisma.player.create({ data: { name, eventId: event.id, order: order++ } });
  }
  return event;
}

function ctx(params: Record<string, string>, body: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as any;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  ({ userId: ownerId, token: ownerToken } = await seedUserWithToken("owner"));
  ({ userId: otherUserId, token: otherToken } = await seedUserWithToken("other"));
});

describe("POST /api/events/[id]/randomize authorization", () => {
  it("rejects anonymous callers with 403", async () => {
    const event = await seedEvent(ownerId, ["Alice", "Bob"]);
    const res = await randomize(ctx({ id: event.id }, {}));
    expect(res.status).toBe(403);
  });

  it("rejects a non-owner authenticated caller with 403", async () => {
    const event = await seedEvent(ownerId, ["Alice", "Bob"]);
    const res = await randomize(ctx({ id: event.id }, {}, otherToken));
    expect(res.status).toBe(403);
  });

  it("allows the owner", async () => {
    const event = await seedEvent(ownerId, ["Alice", "Bob"]);
    const res = await randomize(ctx({ id: event.id }, {}, ownerToken));
    expect(res.status).toBe(200);
  });

  it("authorizes nobody on an ownerless event", async () => {
    const event = await seedEvent(null, ["Alice", "Bob"]);
    const res = await randomize(ctx({ id: event.id }, {}, otherToken));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/me/calendar-token event scope authorization", () => {
  it("rejects anonymous callers", async () => {
    const event = await seedEvent(ownerId);
    const res = await calendarToken(ctx({}, { scope: "event", eventId: event.id }));
    expect(res.status).toBe(401);
  });

  it("rejects an authenticated user who is not part of the event", async () => {
    const event = await seedEvent(ownerId);
    const res = await calendarToken(ctx({}, { scope: "event", eventId: event.id }, otherToken));
    expect(res.status).toBe(403);
  });

  it("issues a feed token to the event owner", async () => {
    const event = await seedEvent(ownerId);
    const res = await calendarToken(ctx({}, { scope: "event", eventId: event.id }, ownerToken));
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBeTruthy();
  });
});

describe("PUT /api/events/[id]/payments/settlement cross-event guard", () => {
  it("rejects a gameId that belongs to a different event", async () => {
    const eventA = await seedEvent(ownerId);
    const eventB = await seedEvent(otherUserId);
    const gameB = await prisma.game.create({
      data: { eventId: eventB.id, dateTime: new Date(), status: "upcoming" },
    });

    const res = await settleShare(
      ctx({ id: eventA.id }, { gameId: gameB.id, eventPlayerId: "whatever" }, ownerToken),
    );
    expect(res.status).toBe(400);
  });
});
