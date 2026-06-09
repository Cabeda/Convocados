import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

import { PUT as updateShowCompetitiveData } from "~/pages/api/events/[id]/show-competitive-data";
import { GET as getRatings } from "~/pages/api/events/[id]/ratings/index";
import { GET as getHistory } from "~/pages/api/events/[id]/history/index";

function ctx(params: Record<string, string>, body?: unknown, method = "GET") {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? (method === "GET" ? "POST" : method) : method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL(request.url) } as any;
}

function putCtx(params: Record<string, string>, body: unknown) {
  return ctx(params, body, "PUT");
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return (await prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ...overrides,
    },
  })).id;
}

async function seedUser(overrides: Record<string, unknown> = {}) {
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await prisma.user.create({
    data: { id, name: "Test User", email: `${id}@test.com`, emailVerified: false, ...overrides },
  });
  return id;
}

beforeEach(async () => {
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ─── PUT /api/events/[id]/show-competitive-data ──────────────────────────────

describe("PUT /api/events/[id]/show-competitive-data", () => {
  it("toggles showCompetitiveData", async () => {
    const id = await seedEvent();
    const res = await updateShowCompetitiveData(putCtx({ id }, { showCompetitiveData: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.showCompetitiveData).toBe(false);
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event!.showCompetitiveData).toBe(false);
  });

  it("returns 404 for unknown event", async () => {
    const res = await updateShowCompetitiveData(putCtx({ id: "nonexistent" }, { showCompetitiveData: false }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when owned event and request is not from owner", async () => {
    const userId = await seedUser();
    const id = await seedEvent({ ownerId: userId });
    const res = await updateShowCompetitiveData(putCtx({ id }, { showCompetitiveData: false }));
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/events/[id]/ratings — respects showCompetitiveData ─────────────

describe("GET /api/events/[id]/ratings with showCompetitiveData", () => {
  it("returns ratings normally when showCompetitiveData is true", async () => {
    const id = await seedEvent({ showCompetitiveData: true });
    await prisma.playerRating.create({ data: { eventId: id, name: "Alice", rating: 1100, gamesPlayed: 3, wins: 2, draws: 0, losses: 1 } });
    const res = await getRatings(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Alice");
  });

  it("returns 403 for non-admins when showCompetitiveData is false on owned event", async () => {
    const userId = await seedUser();
    const id = await seedEvent({ ownerId: userId, showCompetitiveData: false });
    await prisma.playerRating.create({ data: { eventId: id, name: "Alice", rating: 1100, gamesPlayed: 3, wins: 2, draws: 0, losses: 1 } });
    const res = await getRatings(ctx({ id }));
    expect(res.status).toBe(403);
  });

  it("allows access when showCompetitiveData is false on ownerless event", async () => {
    // Ownerless events: the condition `event.ownerId && !isOwner && !isAdmin` is false
    const id = await seedEvent({ ownerId: null, showCompetitiveData: false });
    await prisma.playerRating.create({ data: { eventId: id, name: "Bob", rating: 1050, gamesPlayed: 1, wins: 1, draws: 0, losses: 0 } });
    const res = await getRatings(ctx({ id }));
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/events/[id]/history — respects showCompetitiveData ─────────────

describe("GET /api/events/[id]/history with showCompetitiveData", () => {
  it("returns scores when showCompetitiveData is true", async () => {
    const id = await seedEvent({ showCompetitiveData: true });
    await prisma.gameHistory.create({
      data: { eventId: id, dateTime: new Date(), teamOneName: "A", teamTwoName: "B", scoreOne: 3, scoreTwo: 1, editableUntil: new Date(Date.now() + 86400_000) },
    });
    const res = await getHistory(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].scoreOne).toBe(3);
    expect(body.data[0].scoreTwo).toBe(1);
  });

  it("hides scores for non-admins when showCompetitiveData is false", async () => {
    const userId = await seedUser();
    const id = await seedEvent({ ownerId: userId, showCompetitiveData: false });
    await prisma.gameHistory.create({
      data: { eventId: id, dateTime: new Date(), teamOneName: "A", teamTwoName: "B", scoreOne: 3, scoreTwo: 1, editableUntil: new Date(Date.now() + 86400_000) },
    });
    const res = await getHistory(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].scoreOne).toBeNull();
    expect(body.data[0].scoreTwo).toBeNull();
    expect(body.data[0].eloUpdates).toBeNull();
  });

  it("still returns team info when scores are hidden", async () => {
    const userId = await seedUser();
    const id = await seedEvent({ ownerId: userId, showCompetitiveData: false });
    await prisma.gameHistory.create({
      data: { eventId: id, dateTime: new Date(), teamOneName: "Tigers", teamTwoName: "Bears", scoreOne: 2, scoreTwo: 2, editableUntil: new Date(Date.now() + 86400_000) },
    });
    const res = await getHistory(ctx({ id }));
    const body = await res.json();
    expect(body.data[0].teamOneName).toBe("Tigers");
    expect(body.data[0].teamTwoName).toBe("Bears");
  });
});
