import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock auth
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

import { checkOwnership } from "~/lib/auth.helpers.server";
const mockCheckOwnership = vi.mocked(checkOwnership);

import { GET, PATCH } from "~/pages/api/events/[id]/ratings/index";
import { POST as recalculate } from "~/pages/api/events/[id]/ratings/recalculate";

function ctx(params: Record<string, string>, body?: unknown, method?: string, queryString?: string) {
  const urlStr = `http://localhost/api/test${queryString ? `?${queryString}` : ""}`;
  const request = new Request(urlStr, {
    method: method ?? (body !== undefined ? "PATCH" : "GET"),
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL(urlStr) } as any;
}

async function seedEvent(ownerId?: string) {
  if (ownerId) {
    await seedUser(ownerId, "Owner");
  }
  const event = await prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: ownerId ?? null,
    },
  });
  return event;
}

async function seedUser(id: string, name: string) {
  await prisma.user.upsert({
    where: { id },
    create: { id, name, email: `${id}@test.com`, emailVerified: true },
    update: {},
  });
}

describe("Ratings API — initial rating", () => {
  beforeEach(async () => {
    await prisma.playerRating.deleteMany();
    await prisma.gameHistory.deleteMany();
    await prisma.eventAdmin.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    await resetApiRateLimitStore();
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
  });

  // ── PATCH — set initial rating ──────────────────────────────────────────────

  it("sets initial rating for a new player", async () => {
    const event = await seedEvent("owner1");

    const res = await PATCH(ctx({ id: event.id }, { name: "Alice", initialRating: 1200 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rating).toBe(1200);
    expect(body.initialRating).toBe(1200);
    expect(body.needsRecalculate).toBe(false);

    // Verify in DB
    const rating = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId: event.id, name: "Alice" } },
    });
    expect(rating!.rating).toBe(1200);
    expect(rating!.initialRating).toBe(1200);
  });

  it("updates initial rating for existing player with no games", async () => {
    const event = await seedEvent("owner1");
    await prisma.playerRating.create({
      data: { eventId: event.id, name: "Bob", rating: 1000 },
    });

    const res = await PATCH(ctx({ id: event.id }, { name: "Bob", initialRating: 1100 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rating).toBe(1100); // live rating updated too
    expect(body.initialRating).toBe(1100);
    expect(body.needsRecalculate).toBe(false);
  });

  it("sets initial rating for player with games — only stores initialRating, not live rating", async () => {
    const event = await seedEvent("owner1");
    await prisma.playerRating.create({
      data: { eventId: event.id, name: "Charlie", rating: 1050, gamesPlayed: 5 },
    });

    const res = await PATCH(ctx({ id: event.id }, { name: "Charlie", initialRating: 1200 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rating).toBe(1050); // live rating NOT changed
    expect(body.initialRating).toBe(1200);
    expect(body.needsRecalculate).toBe(true);
  });

  it("clamps rating to 500–1500 range", async () => {
    const event = await seedEvent("owner1");

    const res1 = await PATCH(ctx({ id: event.id }, { name: "Low", initialRating: 100 }));
    const body1 = await res1.json();
    expect(body1.rating).toBe(500);

    const res2 = await PATCH(ctx({ id: event.id }, { name: "High", initialRating: 2000 }));
    const body2 = await res2.json();
    expect(body2.rating).toBe(1500);
  });

  it("returns 400 for missing name", async () => {
    const event = await seedEvent("owner1");

    const res = await PATCH(ctx({ id: event.id }, { initialRating: 1100 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing initialRating", async () => {
    const event = await seedEvent("owner1");

    const res = await PATCH(ctx({ id: event.id }, { name: "Alice" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-owner/non-admin", async () => {
    const event = await seedEvent("owner1");
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const res = await PATCH(ctx({ id: event.id }, { name: "Alice", initialRating: 1200 }));
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await PATCH(ctx({ id: "nonexistent" }, { name: "Alice", initialRating: 1200 }));
    expect(res.status).toBe(404);
  });

  // ── GET — includes initialRating ────────────────────────────────────────────

  it("GET returns initialRating field", async () => {
    const event = await seedEvent();
    await prisma.playerRating.create({
      data: { eventId: event.id, name: "Alice", rating: 1200, initialRating: 1200 },
    });

    const res = await GET(ctx({ id: event.id }, undefined, "GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].initialRating).toBe(1200);
  });

  it("GET returns null initialRating for players without one", async () => {
    const event = await seedEvent();
    await prisma.playerRating.create({
      data: { eventId: event.id, name: "Bob", rating: 1000 },
    });

    const res = await GET(ctx({ id: event.id }, undefined, "GET"));
    const body = await res.json();
    expect(body.data[0].initialRating).toBeNull();
  });

  // ── Recalculate preserves initial ratings ───────────────────────────────────

  it("recalculate preserves manually-set initial ratings", async () => {
    const event = await seedEvent();

    // Create players with initial ratings
    await prisma.playerRating.create({
      data: { eventId: event.id, name: "Alice", rating: 1200, initialRating: 1200, gamesPlayed: 1 },
    });
    await prisma.playerRating.create({
      data: { eventId: event.id, name: "Bob", rating: 1000, gamesPlayed: 1 },
    });

    // Add a game history entry
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(),
        status: "played",
        scoreOne: 3,
        scoreTwo: 1,
        teamOneName: "T1",
        teamTwoName: "T2",
        teamsSnapshot: JSON.stringify([
          { team: "T1", players: [{ name: "Alice", order: 0 }] },
          { team: "T2", players: [{ name: "Bob", order: 0 }] },
        ]),
        editableUntil: new Date(Date.now() + 86400_000),
        eloProcessed: true,
      },
    });

    const res = await recalculate(ctx({ id: event.id }, {}, "POST"));
    expect(res.status).toBe(200);

    // Alice should still have her initial rating preserved
    const alice = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId: event.id, name: "Alice" } },
    });
    expect(alice!.initialRating).toBe(1200);
    // Her live rating should be recalculated from 1200 base
    expect(alice!.gamesPlayed).toBe(1);

    // Bob should have no initial rating (started from default 1000)
    const bob = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId: event.id, name: "Bob" } },
    });
    expect(bob!.initialRating).toBeNull();
    expect(bob!.gamesPlayed).toBe(1);
  });
});
