import { describe, it, expect, beforeEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { getLifetimeSkill } from "~/lib/skill.server";

const mockCheckOwnership = vi.fn();
const mockGetSession = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: vi.fn(),
  checkOwnership: (...args: unknown[]) => mockCheckOwnership(...args),
}));

const mockGetSeasonForEvent = vi.fn();
const mockAuthorize = vi.fn();
vi.mock("~/lib/seasonSetup.server", () => ({
  getSeasonForEvent: (...args: unknown[]) => mockGetSeasonForEvent(...args),
  authorizeSeasonRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

const mockGetSeasonRankPayload = vi.fn();
vi.mock("~/lib/seasonRank.server", () => ({
  getSeasonRankPayload: (...args: unknown[]) => mockGetSeasonRankPayload(...args),
}));

import { PUT as putCompetition } from "~/pages/api/events/[id]/competition";
import { GET as getRank } from "~/pages/api/events/[id]/seasons/[seasonId]/rank";

function context(params: Record<string, string>, method: string, body?: unknown) {
  const req = new Request("http://localhost/api/events/x", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request: req, params, url: new URL(req.url) } as unknown as APIContext;
}

beforeEach(async () => {
  resetApiRateLimitStore();
  vi.clearAllMocks();
  await prisma.seasonRankSnapshot.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.season.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

async function seedEvent() {
  const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "o@test" } });
  return prisma.event.create({ data: { title: "T", location: "L", dateTime: new Date("2026-01-01"), maxPlayers: 10, ownerId: owner.id, eloEnabled: true, rankEnabled: true, balanced: true } });
}

describe("PUT /api/events/:id/competition", () => {
  it("lets the owner disable the whole competitive stack", async () => {
    const event = await seedEvent();
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false });
    const res = await putCompetition(context({ id: event.id }, "PUT", { enabled: false }));
    expect(res.status).toBe(200);
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.eloEnabled).toBe(false);
    expect(updated?.rankEnabled).toBe(false);
    expect(updated?.balanced).toBe(false);
  });

  it("lets the owner enable the master and set advanced rank options", async () => {
    const event = await seedEvent();
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false });
    const res = await putCompetition(context({ id: event.id }, "PUT", { enabled: true, rankDecayEnabled: true, inactiveRankBehavior: "reset" }));
    expect(res.status).toBe(200);
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.rankDecayEnabled).toBe(true);
    expect(updated?.inactiveRankBehavior).toBe("reset");
  });

  it("rejects non-owners", async () => {
    const event = await seedEvent();
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false });
    const res = await putCompetition(context({ id: event.id }, "PUT", { enabled: true }));
    expect(res.status).toBe(403);
  });

  it("locks while a Season is active", async () => {
    const event = await seedEvent();
    await prisma.season.create({ data: { eventId: event.id, name: "S", registrationOpensAt: new Date("2026-01-01"), registrationClosesAt: new Date("2026-02-01"), status: "active" } });
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false });
    const res = await putCompetition(context({ id: event.id }, "PUT", { enabled: false }));
    expect(res.status).toBe(409);
  });

  it("rejects invalid JSON and empty updates", async () => {
    const event = await seedEvent();
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false });
    const bad = await putCompetition({ request: new Request("http://x", { method: "PUT", body: "not json" }), params: { id: event.id }, url: new URL("http://x") } as unknown as APIContext);
    expect(bad.status).toBe(400);
    const empty = await putCompetition(context({ id: event.id }, "PUT", {}));
    expect(empty.status).toBe(400);
  });

  it("404s an unknown event", async () => {
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false });
    const res = await putCompetition(context({ id: "nope" }, "PUT", { enabled: true }));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/events/:id/seasons/:seasonId/rank", () => {
  it("404s when the Season is missing", async () => {
    mockGetSeasonForEvent.mockResolvedValue(null);
    const res = await getRank(context({ id: "e", seasonId: "s" }, "GET"));
    expect(res.status).toBe(404);
  });

  it("403s without event access", async () => {
    mockGetSeasonForEvent.mockResolvedValue({ id: "s", eventId: "e" });
    mockAuthorize.mockResolvedValue({ allowed: false });
    const res = await getRank(context({ id: "e", seasonId: "s" }, "GET"));
    expect(res.status).toBe(403);
  });

  it("returns the rank payload with the viewer's name", async () => {
    const event = await seedEvent();
    const user = await prisma.user.create({ data: { id: "u-viewer", name: "Viewer", email: "v@test" } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Viewer", userId: user.id } });
    mockGetSeasonForEvent.mockResolvedValue({ id: "s", eventId: event.id });
    mockAuthorize.mockResolvedValue({ allowed: true });
    mockGetSession.mockResolvedValue({ user: { id: user.id } });
    mockGetSeasonRankPayload.mockResolvedValue({ seasonId: "s", players: [], edges: [0], anchor: 0, gamesCount: 0, enabled: true });
    const res = await getRank(context({ id: event.id, seasonId: "s" }, "GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.youName).toBe("Viewer");
  });
});

describe("getLifetimeSkill", () => {
  it("returns known ratings and defaults unknown players to 1000", async () => {
    const event = await seedEvent();
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Known", rating: 1234, gamesPlayed: 7 } });
    const map = await getLifetimeSkill(event.id, ["Known", "Unknown"]);
    expect(map.get("Known")).toEqual({ rating: 1234, gamesPlayed: 7 });
    expect(map.get("Unknown")).toEqual({ rating: 1000, gamesPlayed: 0 });
  });
});
