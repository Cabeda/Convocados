import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

// Import route handlers directly — they're plain async functions
import { POST as createEvent } from "~/pages/api/events/index";
import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { POST as addPlayer, DELETE as deletePlayer } from "~/pages/api/events/[id]/players";
import { POST as randomize } from "~/pages/api/events/[id]/randomize";
import { PUT as saveTeams } from "~/pages/api/events/[id]/teams";
import { PUT as saveTeamNames } from "~/pages/api/events/[id]/team-names";
import { GET as getKnownPlayers } from "~/pages/api/events/[id]/known-players";
import { PUT as updateSport } from "~/pages/api/events/[id]/sport";
import { GET as getPublicEvents } from "~/pages/api/events/public";

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

// Helper: create a real event in the DB and return its id
async function seedEvent(overrides: Partial<{
  title: string; location: string; dateTime: Date;
  teamOneName: string; teamTwoName: string;
}> = {}) {
  const event = await prisma.event.create({
    data: {
      title: overrides.title ?? "Test Event",
      location: overrides.location ?? "Pitch A",
      dateTime: overrides.dateTime ?? new Date(Date.now() + 86400_000),
      teamOneName: overrides.teamOneName ?? "Ninjas",
      teamTwoName: overrides.teamTwoName ?? "Gunas",
    },
  });
  return event.id;
}

beforeEach(async () => {
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

// ─── POST /api/events ────────────────────────────────────────────────────────

describe("POST /api/events", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  it("creates an event and returns its id", async () => {
    const res = await createEvent(ctx({}, {
      title: "Friday Footy", location: "Pitch B", dateTime: future,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
  });

  it("returns 400 when title is missing", async () => {
    const res = await createEvent(ctx({}, { location: "Pitch B", dateTime: future }));
    expect(res.status).toBe(400);
  });

  it("creates event without location (location is optional)", async () => {
    const res = await createEvent(ctx({}, { title: "X", dateTime: future }));
    expect(res.status).toBe(200);
  });

  it("returns 400 when dateTime is missing", async () => {
    const res = await createEvent(ctx({}, { title: "X", location: "Y" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid dateTime", async () => {
    const res = await createEvent(ctx({}, { title: "X", location: "Y", dateTime: "not-a-date" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for past dateTime", async () => {
    const res = await createEvent(ctx({}, {
      title: "X", location: "Y", dateTime: new Date(Date.now() - 1000).toISOString(),
    }));
    expect(res.status).toBe(400);
  });

  it("creates a recurring event with recurrenceRule", async () => {
    const res = await createEvent(ctx({}, {
      title: "Weekly Game", location: "Pitch C", dateTime: future,
      isRecurring: true, recurrenceFreq: "weekly", recurrenceInterval: 1, recurrenceByDay: "TU",
    }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.recurrenceRule).toBeTruthy();
    expect(event?.nextResetAt).toBeTruthy();
  });

  it("uses default team names when not provided", async () => {
    const res = await createEvent(ctx({}, { title: "X", location: "Y", dateTime: future }));
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.teamOneName).toBe("Ninjas");
    expect(event?.teamTwoName).toBe("Gunas");
  });

  it("returns 429 after rate limit is exceeded", async () => {
    const ip = `test-rate-limit-${Date.now()}`;
    const makeReq = () => {
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "content-type": "application/json", "fly-client-ip": ip },
        body: JSON.stringify({ title: "X", location: "Y", dateTime: future }),
      });
      return { request, params: {} } as any;
    };
    // Exhaust the limit (10 per hour)
    for (let i = 0; i < 10; i++) await createEvent(makeReq());
    const res = await createEvent(makeReq());
    expect(res.status).toBe(429);
  });
});

// ─── GET /api/events/[id] ────────────────────────────────────────────────────

describe("GET /api/events/[id]", () => {
  it("returns event data", async () => {
    const id = await seedEvent();
    const res = await getEvent(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.title).toBe("Test Event");
  });

  it("returns 404 for unknown id", async () => {
    const res = await getEvent(ctx({ id: "nonexistent-id" }));
    expect(res.status).toBe(404);
  });

  it("performs lazy recurrence reset when nextResetAt is in the past", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Recurring", location: "Pitch", dateTime: new Date(Date.now() - 7200_000),
        teamOneName: "Ninjas", teamTwoName: "Gunas",
        isRecurring: true,
        recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1 }),
        nextResetAt: new Date(Date.now() - 3600_000), // 1 hour ago
      },
    });
    const res = await getEvent(ctx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wasReset).toBe(true);
    // dateTime should have advanced
    expect(new Date(body.dateTime).getTime()).toBeGreaterThan(event.dateTime.getTime());
  });
});

// ─── POST /api/events/[id]/players ──────────────────────────────────────────

describe("POST /api/events/[id]/players", () => {
  it("adds a player", async () => {
    const id = await seedEvent();
    const res = await addPlayer(ctx({ id }, { name: "Alice" }));
    expect(res.status).toBe(200);
    const players = await prisma.player.findMany({ where: { eventId: id } });
    expect(players).toHaveLength(1);
    expect(players[0].name).toBe("Alice");
  });

  it("returns 404 for unknown event", async () => {
    const res = await addPlayer(ctx({ id: "bad-id" }, { name: "Alice" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when name is empty", async () => {
    const id = await seedEvent();
    const res = await addPlayer(ctx({ id }, { name: "  " }));
    expect(res.status).toBe(400);
  });

  it("returns 409 for duplicate player name", async () => {
    const id = await seedEvent();
    await addPlayer(ctx({ id }, { name: "Bob" }));
    const res = await addPlayer(ctx({ id }, { name: "Bob" }));
    expect(res.status).toBe(409);
  });
});

// ─── DELETE /api/events/[id]/players ────────────────────────────────────────

describe("DELETE /api/events/[id]/players", () => {
  it("deletes a player by id", async () => {
    const id = await seedEvent();
    await prisma.player.create({ data: { name: "Carol", eventId: id } });
    const player = await prisma.player.findFirst({ where: { eventId: id } });

    const request = new Request("http://localhost/api/test", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: player!.id }),
    });
    const res = await deletePlayer({ request, params: { id } } as any);
    expect(res.status).toBe(200);
    const remaining = await prisma.player.findMany({ where: { eventId: id } });
    expect(remaining).toHaveLength(0);
  });
});

// ─── POST /api/events/[id]/randomize ────────────────────────────────────────

describe("POST /api/events/[id]/randomize", () => {
  it("randomizes players into teams", async () => {
    const id = await seedEvent();
    await prisma.player.createMany({
      data: ["Alice", "Bob", "Carol", "Dave"].map((name) => ({ name, eventId: id })),
    });
    const res = await randomize(ctx({ id }));
    expect(res.status).toBe(200);
    const teams = await prisma.teamResult.findMany({ where: { eventId: id }, include: { members: true } });
    expect(teams).toHaveLength(2);
    const totalMembers = teams.reduce((s, t) => s + t.members.length, 0);
    expect(totalMembers).toBe(4);
  });

  it("returns 404 for unknown event", async () => {
    const res = await randomize(ctx({ id: "bad-id" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 with fewer than 2 players", async () => {
    const id = await seedEvent();
    await prisma.player.create({ data: { name: "Solo", eventId: id } });
    const res = await randomize(ctx({ id }));
    expect(res.status).toBe(400);
  });

  it("excludes bench players from team randomization", async () => {
    const id = await seedEvent();
    await prisma.event.update({ where: { id }, data: { maxPlayers: 4 } });

    await prisma.player.createMany({
      data: [
        { name: "Alice", eventId: id, order: 0 },
        { name: "Bob", eventId: id, order: 1 },
        { name: "Carol", eventId: id, order: 2 },
        { name: "Dave", eventId: id, order: 3 },
        { name: "Eve", eventId: id, order: 4 },
        { name: "Frank", eventId: id, order: 5 },
      ],
    });

    const res = await randomize(ctx({ id }));
    expect(res.status).toBe(200);

    const teams = await prisma.teamResult.findMany({
      where: { eventId: id },
      include: { members: true },
    });

    const totalMembers = teams.reduce((s, t) => s + t.members.length, 0);

    expect(totalMembers).toBe(4);

    const allNames = teams.flatMap((t) => t.members.map((m) => m.name));
    expect(allNames).toContain("Alice");
    expect(allNames).toContain("Bob");
    expect(allNames).toContain("Carol");
    expect(allNames).toContain("Dave");
    expect(allNames).not.toContain("Eve");
    expect(allNames).not.toContain("Frank");
  });
});

// ─── PUT /api/events/[id]/teams ──────────────────────────────────────────────

describe("PUT /api/events/[id]/teams", () => {
  it("saves team assignments", async () => {
    const id = await seedEvent();
    await prisma.player.createMany({
      data: [
        { name: "Alice", eventId: id, order: 0 },
        { name: "Bob", eventId: id, order: 1 },
        { name: "Carol", eventId: id, order: 2 },
      ],
    });
    const matches = [
      { team: "Ninjas", players: [{ name: "Alice", order: 0 }, { name: "Bob", order: 1 }] },
      { team: "Gunas", players: [{ name: "Carol", order: 0 }] },
    ];
    const res = await saveTeams(putCtx({ id }, { matches }));
    expect(res.status).toBe(200);
    const teams = await prisma.teamResult.findMany({ where: { eventId: id }, include: { members: true } });
    expect(teams).toHaveLength(2);
  });

  it("rejects bench players in team assignments", async () => {
    const id = await seedEvent();
    await prisma.event.update({ where: { id }, data: { maxPlayers: 2 } });
    await prisma.player.createMany({
      data: [
        { name: "Alice", eventId: id, order: 0 },
        { name: "Bob", eventId: id, order: 1 },
        { name: "Carol", eventId: id, order: 2 },
      ],
    });

    const matches = [
      { team: "Ninjas", players: [{ name: "Alice", order: 0 }] },
      { team: "Gunas", players: [{ name: "Carol", order: 0 }] },
    ];

    const res = await saveTeams(putCtx({ id }, { matches }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Carol");
  });
});

// ─── PUT /api/events/[id]/team-names ────────────────────────────────────────

describe("PUT /api/events/[id]/team-names", () => {
  it("updates team names", async () => {
    const id = await seedEvent();
    const res = await saveTeamNames(putCtx({ id }, { teamOneName: "Eagles", teamTwoName: "Lions" }));
    expect(res.status).toBe(200);
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.teamOneName).toBe("Eagles");
    expect(event?.teamTwoName).toBe("Lions");
  });

  it("falls back to defaults when names are empty", async () => {
    const id = await seedEvent();
    await saveTeamNames(putCtx({ id }, { teamOneName: "", teamTwoName: "" }));
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.teamOneName).toBe("Ninjas");
    expect(event?.teamTwoName).toBe("Gunas");
  });

  it("falls back to defaults when names are null/undefined", async () => {
    const id = await seedEvent();
    await saveTeamNames(putCtx({ id }, {}));
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.teamOneName).toBe("Ninjas");
    expect(event?.teamTwoName).toBe("Gunas");
  });
});

// ─── Additional branch coverage ──────────────────────────────────────────────

describe("POST /api/events branch coverage", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  it("reads IP from x-forwarded-for when fly-client-ip is absent", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      body: JSON.stringify({ title: "X", location: "Y", dateTime: future }),
    });
    const res = await createEvent({ request, params: {} } as any);
    expect(res.status).toBe(200);
  });

  it("stores custom team names", async () => {
    const res = await createEvent(ctx({}, {
      title: "X", location: "Y", dateTime: future,
      teamOneName: "Wolves", teamTwoName: "Bears",
    }));
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.teamOneName).toBe("Wolves");
    expect(event?.teamTwoName).toBe("Bears");
  });

  it("creates recurring event with non-numeric interval (defaults to 1)", async () => {
    const res = await createEvent(ctx({}, {
      title: "X", location: "Y", dateTime: future,
      isRecurring: true, recurrenceFreq: "weekly", recurrenceInterval: "bad",
    }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    const rule = JSON.parse(event?.recurrenceRule ?? "{}");
    expect(rule.interval).toBe(1);
  });

  it("creates recurring event without byDay", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json", "fly-client-ip": `unique-${Date.now()}-noday` },
      body: JSON.stringify({ title: "X", location: "Y", dateTime: future,
        isRecurring: true, recurrenceFreq: "monthly", recurrenceInterval: 1 }),
    });
    const res = await createEvent({ request, params: {} } as any);
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    const rule = JSON.parse(event?.recurrenceRule ?? "{}");
    expect(rule.byDay).toBeUndefined();
  });
});

describe("POST /api/events/[id]/players branch coverage", () => {
  it("rethrows non-P2002 errors", async () => {
    const id = await seedEvent();
    // Mock prisma.player.create to throw a generic error
    const original = prisma.player.create;
    (prisma.player as any).create = vi.fn().mockRejectedValueOnce(new Error("DB connection lost"));
    try {
      await expect(addPlayer(ctx({ id }, { name: "Alice" }))).rejects.toThrow("DB connection lost");
    } finally {
      (prisma.player as any).create = original;
    }
  });
});

// ─── GET /api/events/[id]/known-players ─────────────────────────────────────

describe("GET /api/events/[id]/known-players", () => {
  async function seedHistory(eventId: string, teamsSnapshot: string) {
    await prisma.gameHistory.create({
      data: {
        eventId,
        dateTime: new Date(),
        status: "played",
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot,
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });
  }

  it("returns 404 for unknown event", async () => {
    const res = await getKnownPlayers(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("returns empty array when no history exists", async () => {
    const id = await seedEvent();
    const res = await getKnownPlayers(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.players).toEqual([]);
  });

  it("extracts player names from history snapshots", async () => {
    const id = await seedEvent();
    const snapshot = JSON.stringify([
      { team: "A", players: [{ name: "Alice", order: 0 }, { name: "Bob", order: 1 }] },
      { team: "B", players: [{ name: "Carol", order: 0 }] },
    ]);
    await seedHistory(id, snapshot);
    const res = await getKnownPlayers(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.players).toHaveLength(3);
    expect(body.players.map((p: any) => p.name).sort()).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("sorts by frequency (most games first)", async () => {
    const id = await seedEvent();
    const snap1 = JSON.stringify([
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ]);
    const snap2 = JSON.stringify([
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Carol", order: 0 }] },
    ]);
    await seedHistory(id, snap1);
    await seedHistory(id, snap2);
    const res = await getKnownPlayers(ctx({ id }));
    const body = await res.json();
    expect(body.players[0].name).toBe("Alice");
    expect(body.players[0].gamesPlayed).toBe(2);
  });

  it("excludes current players from suggestions", async () => {
    const id = await seedEvent();
    await prisma.player.createMany({ data: [{ name: "Alice", eventId: id }] });
    const snapshot = JSON.stringify([
      { team: "A", players: [{ name: "Alice", order: 0 }, { name: "Bob", order: 1 }] },
      { team: "B", players: [{ name: "Carol", order: 0 }] },
    ]);
    await seedHistory(id, snapshot);
    const res = await getKnownPlayers(ctx({ id }));
    const body = await res.json();
    const names = body.players.map((p: any) => p.name);
    expect(names).not.toContain("Alice");
    expect(names).toContain("Bob");
    expect(names).toContain("Carol");
  });

  it("skips malformed JSON in teamsSnapshot", async () => {
    const id = await seedEvent();
    await seedHistory(id, "not-valid-json");
    const goodSnapshot = JSON.stringify([
      { team: "A", players: [{ name: "Bob", order: 0 }] },
      { team: "B", players: [{ name: "Carol", order: 0 }] },
    ]);
    await seedHistory(id, goodSnapshot);
    const res = await getKnownPlayers(ctx({ id }));
    const body = await res.json();
    expect(body.players).toHaveLength(2);
  });

  it("skips cancelled history entries", async () => {
    const id = await seedEvent();
    await prisma.gameHistory.create({
      data: {
        eventId: id,
        dateTime: new Date(),
        status: "cancelled",
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "Ghost", order: 0 }] },
          { team: "B", players: [{ name: "Phantom", order: 0 }] },
        ]),
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });
    const res = await getKnownPlayers(ctx({ id }));
    const body = await res.json();
    expect(body.players).toEqual([]);
  });

  it("skips entries with null teamsSnapshot", async () => {
    const id = await seedEvent();
    await prisma.gameHistory.create({
      data: {
        eventId: id,
        dateTime: new Date(),
        status: "played",
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: null,
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });
    const res = await getKnownPlayers(ctx({ id }));
    const body = await res.json();
    expect(body.players).toEqual([]);
  });

  it("skips empty player names", async () => {
    const id = await seedEvent();
    const snapshot = JSON.stringify([
      { team: "A", players: [{ name: "  ", order: 0 }, { name: "Bob", order: 1 }] },
      { team: "B", players: [{ name: "", order: 0 }] },
    ]);
    await seedHistory(id, snapshot);
    const res = await getKnownPlayers(ctx({ id }));
    const body = await res.json();
    expect(body.players).toHaveLength(1);
    expect(body.players[0].name).toBe("Bob");
  });
});

// ─── POST /api/events — sport field ─────────────────────────────────────────

describe("POST /api/events — sport field", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  function sportCtx(body: unknown) {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json", "fly-client-ip": `sport-test-${Date.now()}` },
      body: JSON.stringify(body),
    });
    return { request, params: {}, url: new URL("http://localhost/api/test") } as any;
  }

  it("creates event with default sport when not provided", async () => {
    const res = await createEvent(sportCtx({ title: "X", dateTime: future }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(id).toBeTruthy();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.sport).toBe("football-5v5");
  });

  it("creates event with custom sport", async () => {
    const res = await createEvent(sportCtx({ title: "Padel Game", dateTime: future, sport: "padel" }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(id).toBeTruthy();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.sport).toBe("padel");
  });

  it("truncates sport to 50 chars", async () => {
    const longSport = "a".repeat(100);
    const res = await createEvent(sportCtx({ title: "X", dateTime: future, sport: longSport }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(id).toBeTruthy();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.sport.length).toBeLessThanOrEqual(50);
  });
});

// ─── PUT /api/events/[id]/sport ─────────────────────────────────────────────

describe("PUT /api/events/[id]/sport", () => {
  it("updates sport and resets maxPlayers to sport default", async () => {
    const id = await seedEvent();
    const res = await updateSport(putCtx({ id }, { sport: "padel" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sport).toBe("padel");
    expect(body.maxPlayers).toBe(4);

    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.sport).toBe("padel");
    expect(event?.maxPlayers).toBe(4);
  });

  it("updates to football-7v7 and sets maxPlayers to 14", async () => {
    const id = await seedEvent();
    const res = await updateSport(putCtx({ id }, { sport: "football-7v7" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sport).toBe("football-7v7");
    expect(body.maxPlayers).toBe(14);
  });

  it("returns 404 for unknown event", async () => {
    const res = await updateSport(putCtx({ id: "nonexistent" }, { sport: "padel" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when sport is empty", async () => {
    const id = await seedEvent();
    const res = await updateSport(putCtx({ id }, { sport: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when sport is missing", async () => {
    const id = await seedEvent();
    const res = await updateSport(putCtx({ id }, {}));
    expect(res.status).toBe(400);
  });

  it("uses default maxPlayers for unknown sport id", async () => {
    const id = await seedEvent();
    const res = await updateSport(putCtx({ id }, { sport: "unknown-sport" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxPlayers).toBe(10); // falls back to first preset default
  });
});

// ─── GET /api/events/public ─────────────────────────────────────────────────

describe("GET /api/events/public", () => {
  it("returns empty array when no public events exist", async () => {
    const res = await getPublicEvents(ctx({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it("returns only public events", async () => {
    await prisma.event.create({
      data: {
        title: "Public Game", location: "Pitch A",
        dateTime: new Date(Date.now() + 86400_000),
        isPublic: true,
      },
    });
    await prisma.event.create({
      data: {
        title: "Private Game", location: "Pitch B",
        dateTime: new Date(Date.now() + 86400_000),
        isPublic: false,
      },
    });
    const res = await getPublicEvents(ctx({}));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Public Game");
  });

  it("includes sport field in response", async () => {
    await prisma.event.create({
      data: {
        title: "Padel Match", location: "Court 1",
        dateTime: new Date(Date.now() + 86400_000),
        isPublic: true, sport: "padel",
      },
    });
    const res = await getPublicEvents(ctx({}));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].sport).toBe("padel");
  });

  it("includes playerCount and spotsLeft", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Game", location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        isPublic: true, maxPlayers: 4,
      },
    });
    await prisma.player.createMany({
      data: [
        { name: "Alice", eventId: event.id },
        { name: "Bob", eventId: event.id },
      ],
    });
    const res = await getPublicEvents(ctx({}));
    const body = await res.json();
    expect(body.data[0].playerCount).toBe(2);
    expect(body.data[0].spotsLeft).toBe(2);
  });

  it("returns spotsLeft as 0 when full", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Full Game", location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        isPublic: true, maxPlayers: 2,
      },
    });
    await prisma.player.createMany({
      data: [
        { name: "Alice", eventId: event.id },
        { name: "Bob", eventId: event.id },
        { name: "Carol", eventId: event.id },
      ],
    });
    const res = await getPublicEvents(ctx({}));
    const body = await res.json();
    expect(body.data[0].spotsLeft).toBe(0);
  });

  it("supports cursor-based pagination", async () => {
    // Create 3 public events
    for (let i = 0; i < 3; i++) {
      await prisma.event.create({
        data: {
          title: `Game ${i}`, location: "Pitch",
          dateTime: new Date(Date.now() + (i + 1) * 86400_000),
          isPublic: true,
        },
      });
    }
    // Fetch first page with limit=2
    const res1 = await getPublicEvents(ctx({}, undefined, "limit=2"));
    const page1 = await res1.json();
    expect(page1.data).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();

    // Fetch second page using cursor
    const res2 = await getPublicEvents(ctx({}, undefined, `limit=2&cursor=${page1.nextCursor}`));
    const page2 = await res2.json();
    expect(page2.data).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });
});
