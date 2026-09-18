import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock auth — each test picks owner / admin / plain-player.
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

import { checkOwnership } from "~/lib/auth.helpers.server";
const mockCheckOwnership = vi.mocked(checkOwnership);

import { GET, PATCH } from "~/pages/api/events/[id]/ratings/index";
import { POST as recalculate } from "~/pages/api/events/[id]/ratings/recalculate";

function ctx(params: Record<string, string>, body?: unknown, method?: string) {
  const request = new Request("http://localhost/api/test", {
    method: method ?? (body !== undefined ? "PATCH" : "GET"),
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

async function seedUser(id: string, name: string) {
  await prisma.user.upsert({
    where: { id },
    create: { id, name, email: `${id}@test.com`, emailVerified: true },
    update: {},
  });
}

async function seedEvent(ownerId?: string, allowManualRating = false) {
  if (ownerId) await seedUser(ownerId, "Owner");
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: ownerId ?? null,
      allowManualRating,
    },
  });
}

function asOwner() {
  mockCheckOwnership.mockResolvedValue({
    isOwner: true,
    isAdmin: false,
    session: { user: { id: "owner1", name: "Owner" } },
  } as any);
}

function asAdmin() {
  mockCheckOwnership.mockResolvedValue({
    isOwner: false,
    isAdmin: true,
    session: { user: { id: "admin1", name: "Admin" } },
  } as any);
}

function asPlainPlayer() {
  mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);
}

describe("Skill Rating access — owner/admin only", () => {
  beforeEach(async () => {
    await prisma.playerRating.deleteMany();
    await prisma.gameHistory.deleteMany();
    await prisma.eventAdmin.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    await resetApiRateLimitStore();
  });

  describe("GET /api/events/[id]/ratings", () => {
    it("returns 403 for a plain player even when showCompetitiveData is on", async () => {
      const event = await seedEvent("owner1");
      await prisma.playerRating.create({
        data: { eventId: event.id, name: "Alice", rating: 1100, gamesPlayed: 3, wins: 2, draws: 0, losses: 1 },
      });
      asPlainPlayer();

      const res = await GET(ctx({ id: event.id }));
      expect(res.status).toBe(403);
    });

    it("returns 403 for a non-admin on an ownerless event", async () => {
      const event = await seedEvent();
      await prisma.playerRating.create({
        data: { eventId: event.id, name: "Bob", rating: 1050, gamesPlayed: 1, wins: 1, draws: 0, losses: 0 },
      });
      asPlainPlayer();

      const res = await GET(ctx({ id: event.id }));
      expect(res.status).toBe(403);
    });

    it("returns 200 for the event owner", async () => {
      const event = await seedEvent("owner1");
      await prisma.playerRating.create({
        data: { eventId: event.id, name: "Alice", rating: 1100, gamesPlayed: 3, wins: 2, draws: 0, losses: 1 },
      });
      asOwner();

      const res = await GET(ctx({ id: event.id }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("Alice");
      expect(body.data[0].rating).toBe(1100);
    });

    it("returns 200 for an event admin", async () => {
      const event = await seedEvent("owner1");
      await prisma.playerRating.create({
        data: { eventId: event.id, name: "Alice", rating: 1100 },
      });
      asAdmin();

      const res = await GET(ctx({ id: event.id }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data[0].name).toBe("Alice");
    });

    it("returns 404 for an unknown event", async () => {
      asPlainPlayer();
      const res = await GET(ctx({ id: "nonexistent" }));
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/events/[id]/ratings", () => {
    it("returns 403 for a plain player", async () => {
      const event = await seedEvent("owner1", true);
      asPlainPlayer();

      const res = await PATCH(ctx({ id: event.id }, { name: "Alice", initialRating: 1200 }));
      expect(res.status).toBe(403);
    });

    it("returns 200 for the event owner", async () => {
      const event = await seedEvent("owner1", true);
      asOwner();

      const res = await PATCH(ctx({ id: event.id }, { name: "Alice", initialRating: 1200 }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.initialRating).toBe(1200);
    });

    it("returns 200 for an event admin", async () => {
      const event = await seedEvent("owner1", true);
      asAdmin();

      const res = await PATCH(ctx({ id: event.id }, { name: "Alice", initialRating: 1200 }));
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/events/[id]/ratings/recalculate", () => {
    it("returns 403 for a plain player", async () => {
      const event = await seedEvent("owner1");
      asPlainPlayer();

      const res = await recalculate(ctx({ id: event.id }, {}, "POST"));
      expect(res.status).toBe(403);
    });

    it("returns 200 for the event owner", async () => {
      const event = await seedEvent("owner1");
      asOwner();

      const res = await recalculate(ctx({ id: event.id }, {}, "POST"));
      expect(res.status).toBe(200);
    });
  });

  describe("Event.hideEloInTeams default", () => {
    it("defaults to true so ELO is hidden in team views", async () => {
      const event = await seedEvent();
      expect(event.hideEloInTeams).toBe(true);
    });
  });
});
