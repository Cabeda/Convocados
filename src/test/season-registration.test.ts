import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET as listSeasons, POST as createSeason } from "~/pages/api/events/[id]/seasons/index";
import { PATCH as patchSeason } from "~/pages/api/events/[id]/seasons/[seasonId]/index";
import { POST as saveCrews } from "~/pages/api/events/[id]/seasons/[seasonId]/crews/index";
import {
  POST as joinSeason,
  DELETE as withdrawSeason,
} from "~/pages/api/events/[id]/seasons/[seasonId]/membership";

const mockGetSession = vi.fn();
const mockCheckEventAdmin = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: (...args: unknown[]) => mockCheckEventAdmin(...args),
}));

function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/events/test", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function context(
  params: Record<string, string>,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const req = request(method, body, headers);
  return { request: req, params, url: new URL(req.url) } as unknown as APIContext;
}

async function seedEvent(overrides: { ownerId?: string; eloEnabled?: boolean; balanced?: boolean } = {}) {
  for (const id of ["owner-1", "other-user", "user-1"]) {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: { id, name: id, email: `${id}@example.test` },
    });
  }
  const event = await prisma.event.create({
    data: {
      title: "Season Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: overrides.ownerId ?? "owner-1",
      eloEnabled: overrides.eloEnabled ?? true,
      balanced: overrides.balanced ?? true,
    },
  });
  return event;
}

function seasonWindow() {
  const opens = new Date(Date.now() - 60_000);
  const closes = new Date(Date.now() + 14 * 86400_000);
  return { registrationOpensAt: opens.toISOString(), registrationClosesAt: closes.toISOString() };
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckEventAdmin.mockResolvedValue(false);
  await resetApiRateLimitStore();
  await prisma.seasonMembership.deleteMany();
  await prisma.season.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Season registration shell", () => {
  it("requires an owner or event admin to create a Season", async () => {
    const event = await seedEvent({ ownerId: "owner-1" });
    mockGetSession.mockResolvedValue({ user: { id: "other-user" } });

    const response = await createSeason(context({ id: event.id }, "POST", {
      name: "Autumn Season",
      ...seasonWindow(),
    }));

    expect(response.status).toBe(403);
  });

  it("requires ELO and balanced teams before registration can open", async () => {
    const event = await seedEvent({ ownerId: "owner-1", eloEnabled: false });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await createSeason(context({ id: event.id }, "POST", {
      name: "Autumn Season",
      ...seasonWindow(),
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/ELO and balanced/i);
  });

  it("creates registration without adding a game participant", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await createSeason(context({ id: event.id }, "POST", {
      name: "Autumn Season",
      ...seasonWindow(),
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.season.name).toBe("Autumn Season");
    expect(body.season.status).toBe("registration");
    expect(await prisma.gameParticipant.count()).toBe(0);
  });

  it("rejects a second non-terminal Season for the Event", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const first = await createSeason(context({ id: event.id }, "POST", {
      name: "First Season",
      ...seasonWindow(),
    }));
    expect(first.status).toBe(201);

    const second = await createSeason(context({ id: event.id }, "POST", {
      name: "Second Season",
      ...seasonWindow(),
    }));

    expect(second.status).toBe(409);
  });

  it("rejects a new Season whose registration window overlaps a completed Season", async () => {
    const event = await seedEvent();
    // A finished Season occupying January.
    await prisma.season.create({
      data: {
        eventId: event.id,
        name: "January Season",
        status: "completed",
        registrationOpensAt: new Date("2026-01-01"),
        registrationClosesAt: new Date("2026-01-31"),
        completedAt: new Date("2026-02-05"),
      },
    });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    // New window (mid-Jan → mid-Feb) intersects the completed Season.
    const response = await createSeason(context({ id: event.id }, "POST", {
      name: "Overlapping Season",
      registrationOpensAt: new Date("2026-01-15").toISOString(),
      registrationClosesAt: new Date("2026-02-15").toISOString(),
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/overlap/i);
  });

  it("allows a new Season whose window does not overlap a completed Season", async () => {
    const event = await seedEvent();
    await prisma.season.create({
      data: {
        eventId: event.id,
        name: "January Season",
        status: "completed",
        registrationOpensAt: new Date("2026-01-01"),
        registrationClosesAt: new Date("2026-01-31"),
        completedAt: new Date("2026-02-05"),
      },
    });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await createSeason(context({ id: event.id }, "POST", {
      name: "February Season",
      registrationOpensAt: new Date("2026-02-01").toISOString(),
      registrationClosesAt: new Date("2026-02-28").toISOString(),
    }));

    expect(response.status).toBe(201);
  });

  it("ignores cancelled Seasons when checking period overlap", async () => {
    const event = await seedEvent();
    await prisma.season.create({
      data: {
        eventId: event.id,
        name: "Abandoned Season",
        status: "cancelled",
        registrationOpensAt: new Date("2026-01-01"),
        registrationClosesAt: new Date("2026-01-31"),
        cancelledAt: new Date("2026-01-10"),
      },
    });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await createSeason(context({ id: event.id }, "POST", {
      name: "Reused Window Season",
      registrationOpensAt: new Date("2026-01-10").toISOString(),
      registrationClosesAt: new Date("2026-02-10").toISOString(),
    }));

    expect(response.status).toBe(201);
  });

  it("allows public metadata but only exposes the caller membership state", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const created = await createSeason(context({ id: event.id }, "POST", {
      name: "Autumn Season",
      ...seasonWindow(),
    }));
    const seasonId = (await created.json()).season.id;

    mockGetSession.mockResolvedValue(null);
    const response = await listSeasons(context({ id: event.id }, "GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.seasons).toHaveLength(1);
    expect(body.seasons[0]).toMatchObject({ id: seasonId, name: "Autumn Season", memberCount: 0 });
    expect(body.seasons[0].members).toBeUndefined();
    expect(body.seasons[0].currentMembership).toBeNull();
  });

  it("rejects anonymous EventPlayers from joining", async () => {
    const event = await seedEvent();
    const season = await prisma.season.create({
      data: { eventId: event.id, name: "Autumn Season", registrationOpensAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 86400_000) },
    });
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Guest" } });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await joinSeason(context(
      { id: event.id, seasonId: season.id },
      "POST",
      { eventPlayerId: player.id },
    ));

    expect(response.status).toBe(403);
  });

  it("allows an account-linked EventPlayer to join idempotently", async () => {
    const event = await seedEvent();
    const season = await prisma.season.create({
      data: { eventId: event.id, name: "Autumn Season", registrationOpensAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 86400_000) },
    });
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: "user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const first = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }));
    const second = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await prisma.seasonMembership.count()).toBe(1);
    expect(await prisma.gameParticipant.count()).toBe(0);
  });

  it("rejects an EventPlayer belonging to another account", async () => {
    const event = await seedEvent();
    const season = await prisma.season.create({
      data: { eventId: event.id, name: "Autumn Season", registrationOpensAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 86400_000) },
    });
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: "other-user" } });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }));

    expect(response.status).toBe(403);
  });

  it("withdraws without deleting the registration record and allows rejoin", async () => {
    const event = await seedEvent();
    const season = await prisma.season.create({
      data: { eventId: event.id, name: "Autumn Season", registrationOpensAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 86400_000) },
    });
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: "user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }));

    const withdrawn = await withdrawSeason(context({ id: event.id, seasonId: season.id }, "DELETE"));
    const rejoined = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }));
    const membership = await prisma.seasonMembership.findUnique({ where: { seasonId_userId: { seasonId: season.id, userId: "user-1" } } });

    expect(withdrawn.status).toBe(200);
    expect(rejoined.status).toBe(200);
    expect(membership?.status).toBe("active");
    expect(membership?.withdrawnAt).toBeNull();
  });
});

// Builds a registration Season with `crewCount` crews of `perCrew` members plus
// `extraFreeAgents` unassigned participants, all account-linked.
async function seedQualifyingSeason(crewCount: number, perCrew: number, extraFreeAgents = 0) {
  const event = await seedEvent({ ownerId: "owner-1" });
  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: "Pilot Season",
      status: "registration",
      registrationOpensAt: new Date(Date.now() - 60_000),
      registrationClosesAt: new Date(Date.now() + 14 * 86400_000),
      startsAt: new Date(Date.now() - 86400_000),
    },
  });
  let n = 0;
  for (let c = 0; c < crewCount; c++) {
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: `Crew ${c + 1}`, sortOrder: c } });
    for (let m = 0; m < perCrew; m++) {
      const userId = `p-${n}`;
      await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, name: userId, email: `${userId}@t.test` } });
      const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: `Player ${n}`, userId } });
      await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: ep.id, userId, crewId: crew.id, status: "active" } });
      n++;
    }
  }
  for (let f = 0; f < extraFreeAgents; f++) {
    const userId = `fa-${f}`;
    await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, name: userId, email: `${userId}@t.test` } });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: `Free ${f}`, userId } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: ep.id, userId, status: "active" } });
  }
  return { event, season };
}

describe("Season activation gate", () => {
  it("requires an admin to start a Season", async () => {
    const { event, season } = await seedQualifyingSeason(3, 3);
    mockGetSession.mockResolvedValue({ user: { id: "other-user" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));

    expect(response.status).toBe(403);
    expect(await prisma.season.findUnique({ where: { id: season.id } }).then((s) => s?.status)).toBe("registration");
  });

  it("blocks activation below the pilot minimums", async () => {
    const { event, season } = await seedQualifyingSeason(2, 3); // 2 crews, 6 participants
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/at least/i);
  });

  it("activates when the pilot minimums are met, locking the Season", async () => {
    const { event, season } = await seedQualifyingSeason(3, 3); // 3 crews, 9 participants
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));

    expect(response.status).toBe(200);
    const updated = await prisma.season.findUnique({ where: { id: season.id } });
    expect(updated?.status).toBe("active");
    expect(updated?.activatedAt).not.toBeNull();
  });

  it("dissolves non-qualifying Crews and expires free agents on activation", async () => {
    // 3 full crews (9) + 2 free agents; free agents should be withdrawn.
    const { event, season } = await seedQualifyingSeason(3, 3, 2);
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));

    expect(response.status).toBe(200);
    const active = await prisma.seasonMembership.count({ where: { seasonId: season.id, status: "active" } });
    const withdrawn = await prisma.seasonMembership.count({ where: { seasonId: season.id, status: "withdrawn" } });
    expect(active).toBe(9);
    expect(withdrawn).toBe(2);
  });

  it("lets an admin still edit Crews after activation", async () => {
    const { event, season } = await seedQualifyingSeason(3, 3);
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));

    // Rename crews via the admin setup endpoint after the season is active.
    const crews = await prisma.crew.findMany({ where: { seasonId: season.id }, include: { memberships: true }, orderBy: { sortOrder: "asc" } });
    const payload = {
      crews: crews.map((crew, i) => ({ id: crew.id, name: `Renamed ${i + 1}`, membershipIds: crew.memberships.map((m) => m.id) })),
    };
    const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", payload));

    expect(response.status).toBe(200);
    expect(await prisma.crew.findFirst({ where: { seasonId: season.id, name: "Renamed 1" } })).not.toBeNull();
  });

  it("rejects activation on a non-registration Season", async () => {
    const { event, season } = await seedQualifyingSeason(3, 3);
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));

    const again = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/registration/i);
  });

  it("rejects an unsupported PATCH action", async () => {
    const { event, season } = await seedQualifyingSeason(3, 3);
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "explode" }));
    expect(response.status).toBe(400);
  });

  it("rejects invalid JSON on activation", async () => {
    const { event, season } = await seedQualifyingSeason(3, 3);
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const req = new Request("http://localhost/api/events/test", { method: "PATCH", headers: { "content-type": "application/json" }, body: "not json" });
    const ctx = { request: req, params: { id: event.id, seasonId: season.id }, url: new URL(req.url) } as unknown as APIContext;
    const response = await patchSeason(ctx);
    expect(response.status).toBe(400);
  });

  it("requires authentication to activate", async () => {
    const { event, season } = await seedQualifyingSeason(3, 3);
    mockGetSession.mockResolvedValue(null);
    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));
    expect(response.status).toBe(401);
  });

  it("returns 404 activating a Season that does not belong to the Event", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await patchSeason(context({ id: "missing-event", seasonId: "missing-season" }, "PATCH", { action: "activate" }));
    expect(response.status).toBe(404);
  });

  it("blocks activation when a Crew exceeds the maximum size", async () => {
    const { event, season } = await seedQualifyingSeason(3, 3);
    // Push a 4th crew that is oversized (6 members) so it is neither qualifying nor allowed.
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "Oversized", sortOrder: 9 } });
    for (let i = 0; i < 6; i++) {
      const userId = `big-${i}`;
      await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, name: userId, email: `${userId}@t.test` } });
      const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: `Big ${i}`, userId } });
      await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: ep.id, userId, crewId: crew.id, status: "active" } });
    }
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/more than/i);
  });
});

describe("Season create validation", () => {
  it("rejects invalid JSON", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const req = new Request("http://localhost/api/events/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" });
    const ctx = { request: req, params: { id: event.id }, url: new URL(req.url) } as unknown as APIContext;
    const response = await createSeason(ctx);
    expect(response.status).toBe(400);
  });

  it("requires a name and both registration dates", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await createSeason(context({ id: event.id }, "POST", { name: "", ...seasonWindow() }));
    expect(response.status).toBe(400);
  });

  it("rejects a registration window that closes before it opens", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await createSeason(context({ id: event.id }, "POST", {
      name: "Backwards",
      registrationOpensAt: new Date("2026-02-01").toISOString(),
      registrationClosesAt: new Date("2026-01-01").toISOString(),
    }));
    expect(response.status).toBe(400);
  });

  it("requires authentication to create a Season", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue(null);
    const response = await createSeason(context({ id: event.id }, "POST", { name: "X", ...seasonWindow() }));
    expect(response.status).toBe(401);
  });

  it("returns 404 for a missing Event", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await createSeason(context({ id: "no-such-event" }, "POST", { name: "X", ...seasonWindow() }));
    expect(response.status).toBe(404);
  });

  it("reports canManage true for the owner and false for anonymous", async () => {
    const event = await seedEvent({ ownerId: "owner-1" });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const asOwner = await listSeasons(context({ id: event.id }, "GET"));
    expect((await asOwner.json()).canManage).toBe(true);

    mockGetSession.mockResolvedValue(null);
    const asAnon = await listSeasons(context({ id: event.id }, "GET"));
    expect((await asAnon.json()).canManage).toBe(false);
  });
});

describe("Season membership admin override", () => {
  async function closedSeason() {
    const event = await seedEvent({ ownerId: "owner-1" });
    const season = await prisma.season.create({
      data: {
        eventId: event.id,
        name: "Closed Season",
        status: "registration",
        registrationOpensAt: new Date(Date.now() - 30 * 86400_000),
        registrationClosesAt: new Date(Date.now() - 86400_000), // closed yesterday
      },
    });
    return { event, season };
  }

  it("blocks a regular participant from joining after registration closes", async () => {
    const { event, season } = await closedSeason();
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Late", userId: "user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }));
    expect(response.status).toBe(409);
  });

  it("lets an admin change membership after registration closes", async () => {
    const { event, season } = await closedSeason();
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Owner Player", userId: "owner-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const joined = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }));
    expect([200, 201]).toContain(joined.status);
    const withdrawn = await withdrawSeason(context({ id: event.id, seasonId: season.id }, "DELETE"));
    expect(withdrawn.status).toBe(200);
  });

  it("requires authentication to join or withdraw", async () => {
    const { event, season } = await closedSeason();
    mockGetSession.mockResolvedValue(null);
    const join = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: "x" }));
    const leave = await withdrawSeason(context({ id: event.id, seasonId: season.id }, "DELETE"));
    expect(join.status).toBe(401);
    expect(leave.status).toBe(401);
  });

  it("returns 404 joining a Season that does not belong to the Event", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await joinSeason(context({ id: "missing-event", seasonId: "missing-season" }, "POST", { eventPlayerId: "x" }));
    expect(response.status).toBe(404);
  });

  it("rejects an empty eventPlayerId when joining", async () => {
    const event = await seedEvent({ ownerId: "owner-1" });
    const season = await prisma.season.create({
      data: { eventId: event.id, name: "Open", status: "registration", registrationOpensAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 86400_000) },
    });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: "" }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when withdrawing without a registration", async () => {
    const event = await seedEvent({ ownerId: "owner-1" });
    const season = await prisma.season.create({
      data: { eventId: event.id, name: "Open", status: "registration", registrationOpensAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 86400_000) },
    });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await withdrawSeason(context({ id: event.id, seasonId: season.id }, "DELETE"));
    expect(response.status).toBe(404);
  });
});
