import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { hashPassword } from "~/lib/eventAccess";
import { GET as listCandidates } from "~/pages/api/events/[id]/seasons/[seasonId]/memberships/candidates";
import { POST as enrollMember } from "~/pages/api/events/[id]/seasons/[seasonId]/memberships/index";
import { POST as bulkEnroll } from "~/pages/api/events/[id]/seasons/[seasonId]/memberships/bulk";

const mockGetSession = vi.fn();
const mockCheckEventAdmin = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: (...args: unknown[]) => mockCheckEventAdmin(...args),
}));

function context(params: Record<string, string>, method: string, body?: unknown, rawBody?: string) {
  const request = new Request("http://localhost/api/events/test", {
    method,
    headers: { "content-type": "application/json" },
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as unknown as APIContext;
}

async function seedEvent(password = false) {
  for (const id of ["owner-1", "user-1", "other-1"]) {
    await prisma.user.upsert({ where: { id }, update: {}, create: { id, name: id, email: `${id}@example.test` } });
  }
  return prisma.event.create({
    data: {
      title: "Membership Edge",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: "owner-1",
      accessPassword: password ? hashPassword("secret") : null,
      eloEnabled: true,
      balanced: true,
    },
  });
}

async function seedSeason(eventId: string) {
  return prisma.season.create({
    data: {
      eventId,
      name: "Membership Season",
      registrationOpensAt: new Date(Date.now() - 30 * 86400_000),
      registrationClosesAt: new Date(Date.now() + 86400_000),
    },
  });
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckEventAdmin.mockResolvedValue(false);
  await resetApiRateLimitStore();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.season.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function exhaust(handler: (ctx: APIContext) => Response | Promise<Response>) {
  for (let index = 0; index <= 30; index += 1) {
    await handler(context({ id: "none", seasonId: "none" }, "POST", {}));
  }
  return handler(context({ id: "none", seasonId: "none" }, "POST", {}));
}

describe("Single membership enroll edge cases", () => {
  it("requires authentication", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const response = await enrollMember(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: "x" }));
    expect(response.status).toBe(401);
  });

  it("rate limits enrollment", async () => {
    const limited = await exhaust(enrollMember);
    expect(limited.status).toBe(429);
  });

  it("returns 404 without season params", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await enrollMember(context({ id: "none" }, "POST", { eventPlayerId: "x" }));
    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown season", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await enrollMember(context({ id: event.id, seasonId: "missing" }, "POST", { eventPlayerId: "x" }));
    expect(response.status).toBe(404);
  });

  it("denies access to a private event", async () => {
    const event = await seedEvent(true);
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await enrollMember(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: "x" }));
    expect(response.status).toBe(403);
  });

  it("rejects a non-admin with ordinary access", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await enrollMember(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: "x" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/owner or an admin/i);
  });

  it("rejects an array body as invalid JSON", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await enrollMember(context({ id: event.id, seasonId: season.id }, "POST", [1, 2]));
    expect(response.status).toBe(400);
  });

  it("rejects a missing eventPlayerId", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await enrollMember(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: "" }));
    expect(response.status).toBe(400);
  });

  it("rejects non-string and unknown crew ids", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Player", userId: "user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const nonString = await enrollMember(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id, crewId: 7 }));
    const blank = await enrollMember(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id, crewId: " " }));
    const unknown = await enrollMember(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id, crewId: "no-crew" }));

    expect(nonString.status).toBe(400);
    expect(blank.status).toBe(400);
    expect(unknown.status).toBe(404);
  });
});

describe("Bulk membership enroll edge cases", () => {
  it("rate limits bulk enrollment", async () => {
    const limited = await exhaust(bulkEnroll);
    expect(limited.status).toBe(429);
  });

  it("returns 404 without season params", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await bulkEnroll(context({ id: "none" }, "POST", {}));
    expect(response.status).toBe(404);
  });

  it("denies access to a private event", async () => {
    const event = await seedEvent(true);
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await bulkEnroll(context({ id: event.id, seasonId: season.id }, "POST", {}));
    expect(response.status).toBe(403);
  });

  it("returns empty results when nobody played in the window", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "No Games", userId: "user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await bulkEnroll(context({ id: event.id, seasonId: season.id }, "POST", {}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ added: [], skipped: [] });
  });
});

describe("Membership candidates edge cases", () => {
  it("requires authentication", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const response = await listCandidates(context({ id: event.id, seasonId: season.id }, "GET"));
    expect(response.status).toBe(401);
  });

  it("returns 404 without season params and for an unknown season", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const missing = await listCandidates(context({ id: "none" }, "GET"));
    const unknown = await listCandidates(context({ id: event.id, seasonId: "missing" }, "GET"));
    expect(missing.status).toBe(404);
    expect(unknown.status).toBe(404);
  });

  it("denies a non-admin with ordinary access", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await listCandidates(context({ id: event.id, seasonId: season.id }, "GET"));
    expect(response.status).toBe(403);
  });
});
