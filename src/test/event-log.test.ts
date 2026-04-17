import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Ensure route handlers and logEvent use the same prisma client
const _sharedPrisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
vi.mock("~/lib/db.server", () => {
  const { PrismaClient: PC } = require("@prisma/client");
  const p = new PC({ datasources: { db: { url: process.env.DATABASE_URL } } });
  return { prisma: p };
});

import { GET } from "~/pages/api/events/[id]/log";
import { logEvent } from "~/lib/eventLog.server";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCtx(eventId: string, params?: Record<string, string>) {
  const url = new URL(`http://localhost/api/events/${eventId}/log`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const request = new Request(url.toString(), { method: "GET" });
  return { request, params: { id: eventId } } as any;
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

beforeEach(async () => {
  await testPrisma.eventLog.deleteMany();
  await testPrisma.event.deleteMany();
});

// ─── logEvent helper ────────────────────────────────────────────────────────

describe("logEvent helper", () => {
  it("creates a log entry in the database", async () => {
    const event = await seedEvent();
    await logEvent(event.id, "player_added", "Alice", null, { playerName: "Alice" });

    const logs = await testPrisma.eventLog.findMany({ where: { eventId: event.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("player_added");
    expect(logs[0].actor).toBe("Alice");
    expect(logs[0].actorId).toBeNull();
    expect(JSON.parse(logs[0].details)).toEqual({ playerName: "Alice" });
  });

  it("stores actorId when provided", async () => {
    const event = await seedEvent();
    await logEvent(event.id, "ownership_claimed", "Bob", "user-123", {});

    const logs = await testPrisma.eventLog.findMany({ where: { eventId: event.id } });
    expect(logs[0].actorId).toBe("user-123");
  });

  it("does not throw on invalid eventId (swallows errors)", async () => {
    // Should not throw
    await expect(
      logEvent("nonexistent-event", "player_added", null, null, {})
    ).resolves.toBeUndefined();
  });
});

// ─── GET /api/events/:id/log ────────────────────────────────────────────────

describe("GET /api/events/:id/log", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await GET(getCtx("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns empty entries when no logs exist", async () => {
    const event = await seedEvent();
    const res = await GET(getCtx(event.id));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entries).toHaveLength(0);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it("returns log entries in reverse chronological order", async () => {
    const event = await seedEvent();

    await testPrisma.eventLog.create({
      data: { eventId: event.id, action: "player_added", actor: "Alice", details: '{"playerName":"Alice"}' },
    });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await testPrisma.eventLog.create({
      data: { eventId: event.id, action: "player_removed", actor: "Bob", details: '{"playerName":"Charlie"}' },
    });

    const res = await GET(getCtx(event.id));
    const body = await res.json();

    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].action).toBe("player_removed"); // most recent first
    expect(body.entries[1].action).toBe("player_added");
  });

  it("parses details JSON in response", async () => {
    const event = await seedEvent();
    await testPrisma.eventLog.create({
      data: { eventId: event.id, action: "cost_set", details: '{"amount":50,"currency":"EUR"}' },
    });

    const res = await GET(getCtx(event.id));
    const body = await res.json();

    expect(body.entries[0].details).toEqual({ amount: 50, currency: "EUR" });
  });

  it("supports pagination with cursor", async () => {
    const event = await seedEvent();

    // Create 5 entries
    for (let i = 0; i < 5; i++) {
      await testPrisma.eventLog.create({
        data: { eventId: event.id, action: "player_added", actor: `Player ${i}`, details: "{}" },
      });
      await new Promise((r) => setTimeout(r, 5));
    }

    // First page: limit 3
    const res1 = await GET(getCtx(event.id, { limit: "3" }));
    const body1 = await res1.json();
    expect(body1.entries).toHaveLength(3);
    expect(body1.hasMore).toBe(true);
    expect(body1.nextCursor).toBeTruthy();

    // Second page using cursor
    const res2 = await GET(getCtx(event.id, { limit: "3", cursor: body1.nextCursor }));
    const body2 = await res2.json();
    expect(body2.entries).toHaveLength(2);
    expect(body2.hasMore).toBe(false);
  });

  it("does not return logs from other events", async () => {
    const event1 = await seedEvent({ title: "Event 1" });
    const event2 = await seedEvent({ title: "Event 2" });

    await testPrisma.eventLog.create({
      data: { eventId: event1.id, action: "player_added", details: "{}" },
    });
    await testPrisma.eventLog.create({
      data: { eventId: event2.id, action: "cost_set", details: "{}" },
    });

    const res = await GET(getCtx(event1.id));
    const body = await res.json();

    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].action).toBe("player_added");
  });
});
