import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Ensure route handlers use the same prisma client
vi.mock("~/lib/db.server", () => {
  const { PrismaClient: PC } = require("@prisma/client");
  const p = new PC({ datasources: { db: { url: process.env.DATABASE_URL } } });
  return { prisma: p };
});

import { GET } from "~/pages/api/events/[id]/attendance";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCtx(eventId: string) {
  const request = new Request(`http://localhost/api/events/${eventId}/attendance`, { method: "GET" });
  return { request, params: { id: eventId } } as any;
}

function makeSnapshot(teamOne: string[], teamTwo: string[]): string {
  return JSON.stringify([
    { team: "Team A", players: teamOne.map((name, i) => ({ name, order: i })) },
    { team: "Team B", players: teamTwo.map((name, i) => ({ name, order: i })) },
  ]);
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return testPrisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ...overrides,
    },
  });
}

async function seedHistory(eventId: string, dateTime: string, teamOne: string[], teamTwo: string[], status = "played") {
  return testPrisma.gameHistory.create({
    data: {
      eventId,
      dateTime: new Date(dateTime),
      status,
      teamOneName: "Team A",
      teamTwoName: "Team B",
      teamsSnapshot: makeSnapshot(teamOne, teamTwo),
      editableUntil: new Date(Date.now() + 86400_000),
    },
  });
}

beforeEach(async () => {
  await testPrisma.gameHistory.deleteMany();
  await testPrisma.event.deleteMany();
});

// ─── GET /api/events/:id/attendance ─────────────────────────────────────────

describe("GET /api/events/:id/attendance", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await GET(getCtx("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns empty stats when event has no history", async () => {
    const event = await seedEvent();
    const res = await GET(getCtx(event.id));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.totalGames).toBe(0);
    expect(body.players).toHaveLength(0);
  });

  it("returns correct attendance stats for multiple games", async () => {
    const event = await seedEvent();

    // Game 1: Alice, Bob vs Charlie
    await seedHistory(event.id, "2026-01-01", ["Alice", "Bob"], ["Charlie"]);
    // Game 2: Alice vs Charlie (Bob missed)
    await seedHistory(event.id, "2026-01-08", ["Alice"], ["Charlie"]);
    // Game 3: Alice, Bob vs Charlie
    await seedHistory(event.id, "2026-01-15", ["Alice", "Bob"], ["Charlie"]);

    const res = await GET(getCtx(event.id));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.totalGames).toBe(3);
    expect(body.players).toHaveLength(3);

    const alice = body.players.find((p: any) => p.name === "Alice");
    expect(alice.gamesPlayed).toBe(3);
    expect(alice.attendanceRate).toBe(1);
    expect(alice.currentStreak).toBe(3);

    const bob = body.players.find((p: any) => p.name === "Bob");
    expect(bob.gamesPlayed).toBe(2);
    expect(bob.attendanceRate).toBe(0.67);
    expect(bob.currentStreak).toBe(1);
  });

  it("excludes cancelled games from stats", async () => {
    const event = await seedEvent();

    await seedHistory(event.id, "2026-01-01", ["Alice"], ["Bob"]);
    await seedHistory(event.id, "2026-01-08", ["Alice"], ["Bob"], "cancelled");

    const res = await GET(getCtx(event.id));
    const body = await res.json();

    expect(body.totalGames).toBe(1);
    expect(body.players).toHaveLength(2);
  });

  it("returns players sorted by attendance rate descending", async () => {
    const event = await seedEvent();

    await seedHistory(event.id, "2026-01-01", ["Alice", "Bob"], ["Charlie"]);
    await seedHistory(event.id, "2026-01-08", ["Alice"], ["Charlie"]);

    const res = await GET(getCtx(event.id));
    const body = await res.json();

    // Alice and Charlie: 100%, Bob: 50%
    expect(body.players[0].attendanceRate).toBe(1);
    expect(body.players[1].attendanceRate).toBe(1);
    expect(body.players[2].name).toBe("Bob");
    expect(body.players[2].attendanceRate).toBe(0.5);
  });

  it("includes lastPlayed date for each player", async () => {
    const event = await seedEvent();

    await seedHistory(event.id, "2026-01-01", ["Alice", "Bob"], ["Charlie"]);
    await seedHistory(event.id, "2026-01-08", ["Alice"], ["Charlie"]);

    const res = await GET(getCtx(event.id));
    const body = await res.json();

    const bob = body.players.find((p: any) => p.name === "Bob");
    expect(bob.lastPlayed).toBe(new Date("2026-01-01").toISOString());

    const alice = body.players.find((p: any) => p.name === "Alice");
    expect(alice.lastPlayed).toBe(new Date("2026-01-08").toISOString());
  });
});
