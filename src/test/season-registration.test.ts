import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET as listSeasons, POST as createSeason } from "~/pages/api/events/[id]/seasons/index";
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
