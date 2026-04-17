import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

import { GET as getEventCalendar } from "~/pages/api/events/[id]/calendar.ics";
import { GET as getUserCalendar } from "~/pages/api/users/[id]/calendar.ics";
import { GET as getStatus } from "~/pages/api/events/[id]/status";
import { GET as getHealth } from "~/pages/api/health";

function ctx(params: Record<string, string>, queryString?: string) {
  const urlStr = `http://localhost/api/test${queryString ? `?${queryString}` : ""}`;
  const request = new Request(urlStr, {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  return { request, params, url: new URL(urlStr) } as any;
}

async function seedEvent(overrides: Record<string, any> = {}) {
  const event = await prisma.event.create({
    data: {
      title: overrides.title ?? "Test Event",
      location: overrides.location ?? "Pitch A",
      dateTime: overrides.dateTime ?? new Date(Date.now() + 86400_000),
      teamOneName: overrides.teamOneName ?? "Team A",
      teamTwoName: overrides.teamTwoName ?? "Team B",
      ...overrides,
    },
  });
  return event;
}

let userCounter = 0;
async function seedUser(name = "Test User") {
  userCounter++;
  return prisma.user.create({
    data: { id: `user-${userCounter}-${Date.now()}`, name, email: `${name.replace(/\s/g, "").toLowerCase()}-${userCounter}@test.com` },
  });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.calendarToken.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ─── GET /api/health ─────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns ok with journal mode", async () => {
    const res = await getHealth({ request: new Request("http://localhost/api/health"), params: {} } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.db.writable).toBe(true);
    expect(body.db.journalMode).toBeTruthy();
  });

  it("omits litestream field in non-production", async () => {
    const res = await getHealth({ request: new Request("http://localhost/api/health"), params: {} } as any);
    const body = await res.json();
    expect(body.litestream).toBeUndefined();
  });
});

// ─── GET /api/events/[id]/calendar.ics ───────────────────────────────────────

describe("GET /api/events/[id]/calendar.ics", () => {
  it("returns 401 when token is missing", async () => {
    const event = await seedEvent();
    const res = await getEventCalendar(ctx({ id: event.id }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when token is invalid", async () => {
    const event = await seedEvent();
    const res = await getEventCalendar(ctx({ id: event.id }, "token=invalid-token"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when token scope does not match event", async () => {
    const user = await seedUser();
    const event = await seedEvent();
    // Create a token for a different event
    const otherEvent = await seedEvent({ title: "Other Event" });
    const token = await prisma.calendarToken.create({
      data: { token: "valid-event-token", userId: user.id, scope: "event", scopeId: otherEvent.id },
    });
    const res = await getEventCalendar(ctx({ id: event.id }, `token=${token.token}`));
    expect(res.status).toBe(403);
  });

  it("returns 404 when event does not exist", async () => {
    const user = await seedUser();
    const token = await prisma.calendarToken.create({
      data: { token: "valid-token-404", userId: user.id, scope: "event", scopeId: "nonexistent" },
    });
    const res = await getEventCalendar(ctx({ id: "nonexistent" }, `token=${token.token}`));
    expect(res.status).toBe(404);
  });

  it("returns valid iCal feed for a valid token", async () => {
    const user = await seedUser();
    const event = await seedEvent();
    const token = await prisma.calendarToken.create({
      data: { token: "valid-event-feed-token", userId: user.id, scope: "event", scopeId: event.id },
    });
    const res = await getEventCalendar(ctx({ id: event.id }, `token=${token.token}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain(event.title);
  });

  it("returns iCal feed for recurring event", async () => {
    const user = await seedUser();
    const event = await seedEvent({
      isRecurring: true,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=FR",
    });
    const token = await prisma.calendarToken.create({
      data: { token: "recurring-event-token", userId: user.id, scope: "event", scopeId: event.id },
    });
    const res = await getEventCalendar(ctx({ id: event.id }, `token=${token.token}`));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
  });
});

// ─── GET /api/users/[id]/calendar.ics ────────────────────────────────────────

describe("GET /api/users/[id]/calendar.ics", () => {
  it("returns 401 when token is missing", async () => {
    const user = await seedUser();
    const res = await getUserCalendar(ctx({ id: user.id }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when token is invalid", async () => {
    const user = await seedUser();
    const res = await getUserCalendar(ctx({ id: user.id }, "token=bad-token"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when token userId does not match", async () => {
    const user = await seedUser("User A");
    const otherUser = await seedUser("User B");
    const token = await prisma.calendarToken.create({
      data: { token: "user-token-mismatch", userId: otherUser.id, scope: "user" },
    });
    const res = await getUserCalendar(ctx({ id: user.id }, `token=${token.token}`));
    expect(res.status).toBe(403);
  });

  it("returns valid iCal feed for owned events", async () => {
    const user = await seedUser();
    const event = await seedEvent({ ownerId: user.id });
    const token = await prisma.calendarToken.create({
      data: { token: "user-feed-token", userId: user.id, scope: "user" },
    });
    const res = await getUserCalendar(ctx({ id: user.id }, `token=${token.token}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain(event.title);
  });

  it("returns iCal feed including joined events", async () => {
    const user = await seedUser();
    const event = await seedEvent();
    // User joins as a player
    await prisma.player.create({
      data: { name: user.name, eventId: event.id, order: 0, userId: user.id },
    });
    const token = await prisma.calendarToken.create({
      data: { token: "user-joined-token", userId: user.id, scope: "user" },
    });
    const res = await getUserCalendar(ctx({ id: user.id }, `token=${token.token}`));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(event.title);
  });

  it("deduplicates owned and joined events", async () => {
    const user = await seedUser();
    const event = await seedEvent({ ownerId: user.id });
    // User also joins as a player in their own event
    await prisma.player.create({
      data: { name: user.name, eventId: event.id, order: 0, userId: user.id },
    });
    const token = await prisma.calendarToken.create({
      data: { token: "user-dedup-token", userId: user.id, scope: "user" },
    });
    const res = await getUserCalendar(ctx({ id: user.id }, `token=${token.token}`));
    expect(res.status).toBe(200);
    const body = await res.text();
    // Should only appear once
    const eventCount = (body.match(/BEGIN:VEVENT/g) || []).length;
    expect(eventCount).toBe(1);
  });

  it("returns empty calendar when user has no events", async () => {
    const user = await seedUser();
    const token = await prisma.calendarToken.create({
      data: { token: "user-empty-token", userId: user.id, scope: "user" },
    });
    const res = await getUserCalendar(ctx({ id: user.id }, `token=${token.token}`));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).not.toContain("BEGIN:VEVENT");
  });
});

// ─── GET /api/events/[id]/status ─────────────────────────────────────────────

describe("GET /api/events/[id]/status", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await getStatus(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("returns event status with empty players", async () => {
    const event = await seedEvent();
    const res = await getStatus(ctx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(event.id);
    expect(body.title).toBe(event.title);
    expect(body.players.active).toHaveLength(0);
    expect(body.players.bench).toHaveLength(0);
    expect(body.players.total).toBe(0);
    expect(body.players.spotsLeft).toBe(event.maxPlayers);
    expect(body.teams).toHaveLength(0);
  });

  it("returns active and bench players correctly", async () => {
    const event = await seedEvent();
    // Add maxPlayers + 2 players (2 on bench)
    for (let i = 0; i < event.maxPlayers + 2; i++) {
      await prisma.player.create({
        data: { name: `Player ${i}`, eventId: event.id, order: i },
      });
    }
    const res = await getStatus(ctx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.players.active).toHaveLength(event.maxPlayers);
    expect(body.players.bench).toHaveLength(2);
    expect(body.players.total).toBe(event.maxPlayers + 2);
    expect(body.players.spotsLeft).toBe(0);
  });

  it("returns teams when generated", async () => {
    const event = await seedEvent();
    for (let i = 0; i < 4; i++) {
      await prisma.player.create({
        data: { name: `P${i}`, eventId: event.id, order: i },
      });
    }
    await prisma.teamResult.create({
      data: {
        name: "Team A",
        eventId: event.id,
        members: { create: [{ name: "P0", order: 0 }, { name: "P1", order: 1 }] },
      },
    });
    await prisma.teamResult.create({
      data: {
        name: "Team B",
        eventId: event.id,
        members: { create: [{ name: "P2", order: 0 }, { name: "P3", order: 1 }] },
      },
    });
    const res = await getStatus(ctx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams).toHaveLength(2);
    expect(body.teams[0].players).toHaveLength(2);
  });

  it("returns locked response for password-protected event without access", async () => {
    const event = await seedEvent({ accessPassword: "hashed-password" });
    const res = await getStatus(ctx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locked).toBe(true);
    expect(body.hasPassword).toBe(true);
    expect(body.players).toBeUndefined();
  });
});
