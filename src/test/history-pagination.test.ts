import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

import { GET } from "~/pages/api/events/[id]/history/index";

function getCtx(params: Record<string, string>, query = "") {
  const request = new Request(`http://localhost/api/test${query}`, { method: "GET" });
  return { request, params } as any;
}

async function seedEvent() {
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() - 3600_000),
      durationMinutes: 60,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  await resetApiRateLimitStore();
  await prisma.mvpVote.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("GET history — cursor pagination", () => {
  it("pages GameHistory rows without overlap", async () => {
    const event = await seedEvent();
    const base = Date.now();
    for (let i = 0; i < 25; i++) {
      await prisma.gameHistory.create({
        data: {
          eventId: event.id,
          dateTime: new Date(base - i * 3600_000),
          status: "played",
          scoreOne: 3,
          scoreTwo: 2,
          teamOneName: "Ninjas",
          teamTwoName: "Gunas",
        },
      });
    }

    const page1Res = await GET(getCtx({ id: event.id }, "?limit=20"));
    const page1 = await page1Res.json();
    expect(page1.data).toHaveLength(20);
    expect(page1.hasMore).toBe(true);
    expect(new Set(page1.data.map((e: { id: string }) => e.id)).size).toBe(20);

    const page2Res = await GET(getCtx({ id: event.id }, `?limit=20&cursor=${page1.nextCursor}`));
    const page2 = await page2Res.json();
    expect(page2.data).toHaveLength(5);
    expect(page2.hasMore).toBe(false);

    const page1Ids = new Set(page1.data.map((e: { id: string }) => e.id));
    for (const entry of page2.data) {
      expect(page1Ids.has(entry.id)).toBe(false);
    }
  });

  it("pages a mixed GameHistory + played Game timeline without duplicates", async () => {
    const event = await seedEvent();
    const base = Date.now();
    // Interleave: GameHistory on even hours, played Games on odd hours.
    for (let i = 0; i < 15; i++) {
      await prisma.gameHistory.create({
        data: {
          eventId: event.id,
          dateTime: new Date(base - i * 2 * 3600_000),
          status: "played",
          scoreOne: 3,
          scoreTwo: 2,
          teamOneName: "Ninjas",
          teamTwoName: "Gunas",
        },
      });
      await prisma.game.create({
        data: {
          eventId: event.id,
          dateTime: new Date(base - (i * 2 + 1) * 3600_000),
          status: "played",
          scoreOne: 1,
          scoreTwo: 0,
          teamOneName: "Ninjas",
          teamTwoName: "Gunas",
        },
      });
    }

    const page1Res = await GET(getCtx({ id: event.id }, "?limit=20"));
    const page1 = await page1Res.json();
    expect(page1.data).toHaveLength(20);
    expect(page1.hasMore).toBe(true);

    const page2Res = await GET(getCtx({ id: event.id }, `?limit=20&cursor=${page1.nextCursor}`));
    const page2 = await page2Res.json();

    const allIds = [...page1.data, ...page2.data].map((e: { id: string }) => e.id);
    expect(allIds).toHaveLength(30);
    expect(new Set(allIds).size).toBe(30);

    // Descending by dateTime across the whole set.
    const times = [...page1.data, ...page2.data].map((e: { dateTime: string }) => new Date(e.dateTime).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThan(times[i]);
    }
  });
});
