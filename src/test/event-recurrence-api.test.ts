/**
 * PUT /api/events/[id]/recurrence — the post-game "repeat this game / make it
 * recurring" path. Recurrence was previously settable only at creation, so an
 * Owner who just finished a one-off Game had no way to say "same again next
 * week" without recreating the Event.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { PUT } from "~/pages/api/events/[id]/recurrence";

let ownerId = "";
let ownerToken = "";
let otherToken = "";
let eventId = "";

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

function ctx(id: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return {
    request: new Request(`http://localhost/api/events/${id}/recurrence`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    }),
    params: { id },
    url: new URL(`http://localhost/api/events/${id}/recurrence`),
  } as any;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  ({ userId: ownerId, token: ownerToken } = await seedUserWithToken("owner"));
  ({ token: otherToken } = await seedUserWithToken("other"));

  const startsAt = new Date(Date.now() + 86_400_000);
  const event = await prisma.event.create({
    data: {
      title: "Repeatable",
      location: "Pitch",
      dateTime: startsAt,
      durationMinutes: 90,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId,
      isPublic: true,
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: startsAt },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  eventId = event.id;
});

describe("PUT /api/events/[id]/recurrence", () => {
  it("makes a one-off event recurring and arms nextResetAt from the occurrence", async () => {
    const res = await PUT(ctx(eventId, { isRecurring: true, recurrenceFreq: "weekly" }, ownerToken));
    expect(res.status).toBe(200);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event?.isRecurring).toBe(true);
    expect(JSON.parse(event!.recurrenceRule!)).toMatchObject({ freq: "weekly", interval: 1 });
    // nextResetAt = this occurrence's kickoff + durationMinutes (90 min)
    expect(event?.nextResetAt).toBeInstanceOf(Date);
    expect(
      Math.round((event!.nextResetAt!.getTime() - event!.dateTime.getTime()) / 60_000),
    ).toBe(90);
  });

  it("accepts an explicit interval and byDay", async () => {
    const res = await PUT(
      ctx(eventId, { isRecurring: true, recurrenceFreq: "weekly", recurrenceInterval: 2, recurrenceByDay: "TU,TH" }, ownerToken),
    );
    expect(res.status).toBe(200);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(JSON.parse(event!.recurrenceRule!)).toMatchObject({ freq: "weekly", interval: 2, byDay: "TU,TH" });
  });

  it("turns recurrence off and clears the rule and nextResetAt", async () => {
    await PUT(ctx(eventId, { isRecurring: true, recurrenceFreq: "weekly" }, ownerToken));
    const res = await PUT(ctx(eventId, { isRecurring: false }, ownerToken));
    expect(res.status).toBe(200);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event?.isRecurring).toBe(false);
    expect(event?.recurrenceRule).toBeNull();
    expect(event?.nextResetAt).toBeNull();
  });

  it("rejects an unknown recurrence freq", async () => {
    const res = await PUT(ctx(eventId, { isRecurring: true, recurrenceFreq: "hourly" }, ownerToken));
    expect(res.status).toBe(400);
  });

  it("rejects a non-owner", async () => {
    const res = await PUT(ctx(eventId, { isRecurring: true, recurrenceFreq: "weekly" }, otherToken));
    expect(res.status).toBe(403);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event?.isRecurring).toBe(false);
  });

  it("rejects an unauthenticated caller", async () => {
    const res = await PUT(ctx(eventId, { isRecurring: true, recurrenceFreq: "weekly" }));
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown event", async () => {
    const res = await PUT(ctx("does-not-exist", { isRecurring: true, recurrenceFreq: "weekly" }, ownerToken));
    expect(res.status).toBe(404);
  });
});
