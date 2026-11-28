import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/payments/settlement/bulk-undo";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
});

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
    data: { id: `at-${userId}`, token, clientId, userId, scopes: "write:events", expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { userId, token };
}

async function seedSettlementGame() {
  const owner = await seedUserWithToken("owner");
  const alice = await seedUserWithToken("alice");
  const cara = await seedUserWithToken("cara");
  const event = await prisma.event.create({
    data: {
      title: "E",
      location: "P",
      dateTime: new Date(),
      maxPlayers: 10,
      ownerId: owner.userId,
      isPublic: false,
    },
  });
  const aliceEp = await prisma.eventPlayer.create({
    data: { eventId: event.id, name: "Alice", userId: alice.userId },
  });
  const bobEp = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Bob" } });
  const caraEp = await prisma.eventPlayer.create({
    data: { eventId: event.id, name: "Cara", userId: cara.userId },
  });
  const game = await prisma.game.create({
    data: {
      eventId: event.id,
      dateTime: new Date(),
      status: "upcoming",
      paymentMode: "tracked",
      payerEventPlayerId: aliceEp.id,
    },
  });
  for (const [order, ep] of [aliceEp, bobEp, caraEp].entries()) {
    await prisma.gameParticipant.create({
      data: { gameId: game.id, eventPlayerId: ep.id, order },
    });
    await prisma.gamePayment.create({
      data: {
        gameId: game.id,
        eventPlayerId: ep.id,
        playerName: ep.name,
        amount: 10,
        status: "paid",
        method: ep.id === aliceEp.id ? "payer" : "manual",
        paidAt: new Date(),
      },
    });
  }
  return { owner, alice, cara, event, game, aliceEp, bobEp, caraEp };
}

function undoRequest(eventId: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const req = new Request(`http://localhost/api/events/${eventId}/payments/settlement/bulk-undo`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return POST({ params: { id: eventId }, request: req } as any);
}

describe("POST /api/events/[id]/payments/settlement/bulk-undo", () => {
  it("returns 404 for missing event", async () => {
    const req = new Request("http://localhost/api/events/nope/payments/settlement/bulk-undo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: "g", eventPlayerIds: ["ep"] }),
    });
    const res = await POST({ params: { id: "nope" }, request: req } as any);
    expect(res.status).toBe(404);
  });

  it("reverts nothing gracefully for an ownerless unlocked event", async () => {
    const event = await prisma.event.create({
      data: { title: "E", location: "P", dateTime: new Date(), maxPlayers: 10, ownerId: null, isPublic: false },
    });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(), status: "upcoming" } });
    const req = new Request(`http://localhost/api/events/${event.id}/payments/settlement/bulk-undo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: game.id, eventPlayerIds: ["ep-missing"] }),
    });
    const res = await POST({ params: { id: event.id }, request: req } as any);
    expect([200, 400]).toContain(res.status);
  });
});

describe("POST /api/events/[id]/payments/settlement/bulk-undo (locked)", () => {
  it("returns 403 for a password-locked event without access", async () => {
    const event = await prisma.event.create({
      data: { title: "E", location: "P", dateTime: new Date(), maxPlayers: 10, ownerId: null, isPublic: false, accessPassword: "hashed" },
    });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(), status: "upcoming" } });
    const req = new Request(`http://localhost/api/events/${event.id}/payments/settlement/bulk-undo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: game.id, eventPlayerIds: ["ep"] }),
    });
    const res = await POST({ params: { id: event.id }, request: req } as any);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/events/[id]/payments/settlement/bulk-undo (who may undo)", () => {
  it("returns 403 to a non-payer participant and changes no payment row", async () => {
    const { event, game, cara, caraEp, bobEp, aliceEp } = await seedSettlementGame();

    const res = await undoRequest(event.id, {
      gameId: game.id,
      eventPlayerIds: [aliceEp.id, bobEp.id, caraEp.id],
    }, cara.token);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the event owner can do this." });
    const rows = await prisma.gamePayment.findMany({ where: { gameId: game.id } });
    expect(rows.every((row) => row.status === "paid")).toBe(true);
  });

  it("still lets the game's payer undo the settled shares", async () => {
    const { event, game, alice, aliceEp, bobEp, caraEp } = await seedSettlementGame();

    const res = await undoRequest(event.id, {
      gameId: game.id,
      eventPlayerIds: [aliceEp.id, bobEp.id, caraEp.id],
    }, alice.token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reverted: 3 });
    const bob = await prisma.gamePayment.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: bobEp.id } },
    });
    const cara = await prisma.gamePayment.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: caraEp.id } },
    });
    expect(bob.status).toBe("pending");
    expect(cara.status).toBe("pending");
  });

  it("returns 403 to a stood-down payer and changes no payment row", async () => {
    const { event, game, alice, aliceEp, bobEp, caraEp } = await seedSettlementGame();
    await prisma.game.update({ where: { id: game.id }, data: { payerStoodDownAt: new Date() } });

    const res = await undoRequest(event.id, {
      gameId: game.id,
      eventPlayerIds: [aliceEp.id, bobEp.id, caraEp.id],
    }, alice.token);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the event owner can do this." });
    const rows = await prisma.gamePayment.findMany({ where: { gameId: game.id } });
    expect(rows.every((row) => row.status === "paid")).toBe(true);
  });
});
