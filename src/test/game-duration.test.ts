import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import {
  SPORT_PRESETS,
  getSportPreset,
  getDefaultDurationMinutes,
} from "~/lib/sports";
import { isGameEnded, gamePhase, type GamePhase } from "~/lib/gameStatus";
import { POST as createEvent } from "~/pages/api/events/index";
import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { PUT as updateDuration } from "~/pages/api/events/[id]/duration";

// Mock geocoding — event creation calls resolveLocation() for the location
// text, which would otherwise make a real network request to Nominatim on
// every handler call. Tests must be offline and deterministic.
vi.mock("~/lib/geocode", () => ({
  resolveLocation: vi.fn().mockResolvedValue(null),
}));

// Minimal Astro APIContext factory
function ctx(params: Record<string, string>, body?: unknown, queryString?: string) {
  const urlStr = `http://localhost/api/test${queryString ? `?${queryString}` : ""}`;
  const request = new Request(urlStr, {
    method: body !== undefined ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL(urlStr) } as any;
}

function putCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

beforeEach(async () => {
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

// ── Sport duration defaults ─────────────────────────────────────────────────

describe("SPORT_PRESETS — defaultDurationMinutes", () => {
  it("every preset has a defaultDurationMinutes >= 30", () => {
    for (const preset of SPORT_PRESETS) {
      expect(preset.defaultDurationMinutes).toBeGreaterThanOrEqual(30);
    }
  });

  it("football-5v5 defaults to 60 min", () => {
    expect(getSportPreset("football-5v5").defaultDurationMinutes).toBe(60);
  });

  it("football-7v7 defaults to 70 min", () => {
    expect(getSportPreset("football-7v7").defaultDurationMinutes).toBe(70);
  });

  it("football-11v11 defaults to 90 min", () => {
    expect(getSportPreset("football-11v11").defaultDurationMinutes).toBe(90);
  });

  it("futsal defaults to 60 min", () => {
    expect(getSportPreset("futsal").defaultDurationMinutes).toBe(60);
  });

  it("basketball defaults to 48 min", () => {
    expect(getSportPreset("basketball").defaultDurationMinutes).toBe(48);
  });

  it("volleyball defaults to 60 min", () => {
    expect(getSportPreset("volleyball").defaultDurationMinutes).toBe(60);
  });

  it("tennis-singles defaults to 90 min", () => {
    expect(getSportPreset("tennis-singles").defaultDurationMinutes).toBe(90);
  });

  it("tennis-doubles defaults to 90 min", () => {
    expect(getSportPreset("tennis-doubles").defaultDurationMinutes).toBe(90);
  });

  it("padel defaults to 90 min", () => {
    expect(getSportPreset("padel").defaultDurationMinutes).toBe(90);
  });

  it("other defaults to 60 min", () => {
    expect(getSportPreset("other").defaultDurationMinutes).toBe(60);
  });
});

describe("getDefaultDurationMinutes", () => {
  it("returns correct duration for known sports", () => {
    expect(getDefaultDurationMinutes("football-5v5")).toBe(60);
    expect(getDefaultDurationMinutes("basketball")).toBe(48);
    expect(getDefaultDurationMinutes("padel")).toBe(90);
  });

  it("returns default for unknown sport", () => {
    expect(getDefaultDurationMinutes("curling")).toBe(SPORT_PRESETS[0].defaultDurationMinutes);
  });
});

// ── isGameEnded helper ──────────────────────────────────────────────────────

describe("isGameEnded", () => {
  it("returns false when game is in the future", () => {
    const dateTime = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h from now
    expect(isGameEnded(dateTime, 60)).toBe(false);
  });

  it("returns false when game started but duration not elapsed", () => {
    const dateTime = new Date(Date.now() - 30 * 60 * 1000); // started 30 min ago
    expect(isGameEnded(dateTime, 60)).toBe(false);
  });

  it("returns true when game started and duration has elapsed", () => {
    const dateTime = new Date(Date.now() - 90 * 60 * 1000); // started 90 min ago
    expect(isGameEnded(dateTime, 60)).toBe(true);
  });

  it("returns true exactly at the boundary (dateTime + duration = now)", () => {
    const dateTime = new Date(Date.now() - 60 * 60 * 1000); // started exactly 60 min ago
    expect(isGameEnded(dateTime, 60)).toBe(true);
  });

  it("handles string dateTime input", () => {
    const dateTime = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    expect(isGameEnded(dateTime, 60)).toBe(true);
  });

  it("handles zero duration (ended as soon as it started)", () => {
    const dateTime = new Date(Date.now() - 1000); // 1 second ago
    expect(isGameEnded(dateTime, 0)).toBe(true);
  });
});

// ── gamePhase helper ────────────────────────────────────────────────────────

describe("gamePhase", () => {
  const now = new Date("2026-11-27T12:00:00Z");
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60 * 1000);

  it("returns upcoming before kickoff", () => {
    expect(gamePhase({ dateTime: at(30), status: "upcoming" }, 60, now)).toBe("upcoming");
  });

  it("returns in_progress from kickoff until kickoff + duration", () => {
    expect(gamePhase({ dateTime: at(-10), status: "upcoming" }, 60, now)).toBe("in_progress");
    expect(gamePhase({ dateTime: at(0), status: "upcoming" }, 60, now)).toBe("in_progress");
  });

  it("returns played at and after kickoff + duration, without needing a score", () => {
    expect(gamePhase({ dateTime: at(-60), status: "upcoming" }, 60, now)).toBe("played");
    expect(gamePhase({ dateTime: at(-90), status: "upcoming" }, 60, now)).toBe("played");
  });

  it("never derives over cancelled or an already-snapshotted played game", () => {
    expect(gamePhase({ dateTime: at(-10), status: "cancelled" }, 60, now)).toBe("cancelled");
    expect(gamePhase({ dateTime: at(30), status: "played" }, 60, now)).toBe("played");
  });

  // Parity fixture: android-app/wear/.../DateTimeUtil.kt gameListTimeState
  // classifies LIVE by kickoff + the sport's duration. Mirror its sport table
  // and assert the web phase agrees at the same instants.
  it("agrees with the Wear games-list phase for every shared sport duration", () => {
    const wearSportDurationMinutes: Record<string, number> = {
      "football-5v5": 60,
      "football-7v7": 70,
      "football-11v11": 90,
      futsal: 60,
      basketball: 48,
      volleyball: 60,
      "tennis-singles": 90,
      "tennis-doubles": 90,
      padel: 90,
      other: 60,
    };
    const wearPhase = (kickoff: Date, durationMinutes: number): GamePhase => {
      const end = new Date(kickoff.getTime() + durationMinutes * 60 * 1000);
      if (now < kickoff) return "upcoming";
      return now < end ? "in_progress" : "played";
    };

    for (const [sport, duration] of Object.entries(wearSportDurationMinutes)) {
      expect(getDefaultDurationMinutes(sport), sport).toBe(duration);
      for (const offset of [-1, 0, duration / 2, duration, duration + 1]) {
        const kickoff = at(offset);
        expect(
          gamePhase({ dateTime: kickoff, status: "upcoming" }, duration, now),
          `${sport} at ${offset} min`,
        ).toBe(wearPhase(kickoff, duration));
      }
    }
  });
});

// ── Database: durationMinutes field ─────────────────────────────────────────

describe("Event.durationMinutes in database", () => {
  it("defaults to 60 when not specified", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Test",
        location: "Pitch A",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A",
        teamTwoName: "B",
      },
    });
    expect(event.durationMinutes).toBe(60);
  });

  it("can be set to a custom value", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Test",
        location: "Pitch A",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 90,
      },
    });
    expect(event.durationMinutes).toBe(90);
  });

  it("can be updated", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Test",
        location: "Pitch A",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A",
        teamTwoName: "B",
      },
    });
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { durationMinutes: 120 },
    });
    expect(updated.durationMinutes).toBe(120);
  });
});

// ── API: event creation populates durationMinutes from sport ────────────────

describe("POST /api/events — durationMinutes", () => {
  it("sets durationMinutes from sport default on creation", async () => {
    const res = await createEvent(
      ctx({}, {
        title: "Padel Game",
        location: "Court 1",
        dateTime: new Date(Date.now() + 86400_000).toISOString(),
        sport: "padel",
      }),
    );
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event!.durationMinutes).toBe(90);
  });

  it("sets 60 min for football-5v5 by default", async () => {
    const res = await createEvent(
      ctx({}, {
        title: "Football",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000).toISOString(),
        sport: "football-5v5",
      }),
    );
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event!.durationMinutes).toBe(60);
  });

  it("sets 48 min for basketball", async () => {
    const res = await createEvent(
      ctx({}, {
        title: "Hoops",
        location: "Gym",
        dateTime: new Date(Date.now() + 86400_000).toISOString(),
        sport: "basketball",
      }),
    );
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event!.durationMinutes).toBe(48);
  });
});

// ── API: GET /api/events/:id returns durationMinutes ────────────────────────

describe("GET /api/events/:id — durationMinutes", () => {
  it("returns durationMinutes in the response", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Test",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 70,
      },
    });
    const res = await getEvent(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.durationMinutes).toBe(70);
  });
});

// ── API: PUT /api/events/:id/duration ───────────────────────────────────────

describe("PUT /api/events/:id/duration", () => {
  it("updates durationMinutes", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Test",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A",
        teamTwoName: "B",
      },
    });
    const res = await updateDuration(putCtx({ id: event.id }, { durationMinutes: 120 }));
    expect(res.status).toBe(200);
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated!.durationMinutes).toBe(120);
  });

  it("rejects invalid duration (< 0)", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Test",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A",
        teamTwoName: "B",
      },
    });
    const res = await updateDuration(putCtx({ id: event.id }, { durationMinutes: -10 }));
    expect(res.status).toBe(400);
  });

  it("rejects duration > 600", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Test",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A",
        teamTwoName: "B",
      },
    });
    const res = await updateDuration(putCtx({ id: event.id }, { durationMinutes: 700 }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await updateDuration(putCtx({ id: "nonexistent" }, { durationMinutes: 60 }));
    expect(res.status).toBe(404);
  });
});
