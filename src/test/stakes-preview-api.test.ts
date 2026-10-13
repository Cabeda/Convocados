import { describe, it, expect, beforeEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
  checkOwnership: vi.fn(),
}));

import { getStakesPreview } from "~/lib/stakesPreview.server";
import { POST as postStakes } from "~/pages/api/events/[id]/stakes-preview";

function context(params: Record<string, string>, body?: unknown) {
  const req = new Request("http://localhost/api/events/x/stakes-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request: req, params, url: new URL(req.url) } as unknown as APIContext;
}

const WINDOW = { opens: new Date("2026-01-01T00:00:00Z"), closes: new Date("2026-03-01T00:00:00Z") };
const GAME_DATE = new Date("2026-01-15T18:00:00Z");

async function seedSeason(opts: { active?: boolean } = {}) {
  const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "o@test" } });
  const event = await prisma.event.create({
    data: { title: "T", location: "L", dateTime: GAME_DATE, maxPlayers: 10, ownerId: owner.id, rankEnabled: true },
  });
  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: "Season 1",
      registrationOpensAt: WINDOW.opens,
      registrationClosesAt: WINDOW.closes,
      status: opts.active === false ? "registration" : "active",
    },
  });
  return { event, season, owner };
}

interface MembershipInput {
  name: string;
  crew?: string;
  rating?: number;
  games?: number;
}

async function seedMembers(
  eventId: string,
  seasonId: string,
  members: MembershipInput[],
): Promise<Map<string, { userId: string }>> {
  const byName = new Map<string, { userId: string }>();
  const crewIds = new Map<string, string>();
  let order = 0;
  for (const m of members) {
    const user = await prisma.user.create({ data: { id: `u-${m.name}`, name: m.name, email: `${m.name}@test` } });
    const ep = await prisma.eventPlayer.create({ data: { eventId, name: m.name, userId: user.id } });
    await prisma.playerRating.create({
      data: { eventId, name: m.name, rating: m.rating ?? 1000, gamesPlayed: m.games ?? 6 },
    });
    let crewId: string | null = null;
    if (m.crew) {
      crewId = crewIds.get(m.crew) ?? "";
      if (!crewId) {
        const crew = await prisma.crew.create({ data: { seasonId, name: m.crew, sortOrder: order++ } });
        crewId = crew.id;
        crewIds.set(m.crew, crewId);
      }
    }
    await prisma.seasonMembership.create({
      data: { seasonId, eventPlayerId: ep.id, userId: user.id, crewId, status: "active" },
    });
    byName.set(m.name, { userId: user.id });
  }
  return byName;
}

function snapshot(one: string[], two: string[]) {
  return JSON.stringify([
    { team: "Reds", players: one.map((name, i) => ({ name, order: i })) },
    { team: "Blues", players: two.map((name, i) => ({ name, order: i })) },
  ]);
}

async function seedPlayedGame(eventId: string, date: string, one: string[], two: string[]) {
  await prisma.gameHistory.create({
    data: {
      eventId,
      dateTime: new Date(date),
      status: "played",
      scoreOne: 3,
      scoreTwo: 1,
      teamOneName: "Reds",
      teamTwoName: "Blues",
      teamsSnapshot: snapshot(one, two),
    },
  });
}

beforeEach(async () => {
  resetApiRateLimitStore();
  vi.clearAllMocks();
  await prisma.seasonRankSnapshot.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.season.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("getStakesPreview (server assembly)", () => {
  it("projects all three scenarios with Crew associations and round scores", async () => {
    const { event, season } = await seedSeason();
    await seedMembers(event.id, season.id, [
      { name: "Ana", crew: "Sharks", rating: 1100 },
      { name: "Bia", crew: "Sharks", rating: 1000 },
      { name: "Caio", crew: "Wolves", rating: 950 },
      { name: "Dan", crew: "Wolves", rating: 1050 },
    ]);

    const preview = await getStakesPreview(event.id, GAME_DATE, {
      teamOne: ["Ana", "Caio"],
      teamTwo: ["Bia", "Dan"],
    });

    expect(preview).not.toBeNull();
    expect(preview!.roundAvailable).toBe(true);
    expect(preview!.roundsCounted).toBe(0);
    expect(preview!.scenarios).toHaveLength(3);

    const oneWins = preview!.scenarios.find((s) => s.outcome === "teamOne")!;
    expect(oneWins.players.find((p) => p.name === "Ana")!.contribution).toBe(3);
    expect(oneWins.players.find((p) => p.name === "Bia")!.contribution).toBe(0);
    // Sharks = mean(3, 0) = 1.5 → rounded half-up to 2.
    const sharks = oneWins.crews.find((c) => c.name === "Sharks")!;
    expect(sharks.roundScore).toBe(2);
    expect(sharks.positionAfter).toBeGreaterThanOrEqual(1);
    expect(oneWins.crews.find((c) => c.name === "Wolves")!.roundScore).toBe(2);
  });

  it("returns no scenarios once the Season's eight rounds are consumed", async () => {
    const { event, season } = await seedSeason();
    await seedMembers(event.id, season.id, [{ name: "Ana", crew: "Sharks" }]);
    for (let i = 0; i < 8; i++) {
      const day = String(i + 2).padStart(2, "0");
      await seedPlayedGame(event.id, `2026-01-${day}T18:00:00Z`, ["Ana"], ["Rival"]);
    }

    const preview = await getStakesPreview(event.id, new Date("2026-02-15T18:00:00Z"), {
      teamOne: ["Ana"],
      teamTwo: ["Rival"],
    });

    expect(preview!.roundsCounted).toBe(8);
    expect(preview!.roundAvailable).toBe(false);
    expect(preview!.scenarios).toEqual([]);
  });

  it("returns null when no active Season covers the Game", async () => {
    const { event } = await seedSeason({ active: false });
    const preview = await getStakesPreview(event.id, GAME_DATE, { teamOne: ["Ana"], teamTwo: ["Bia"] });
    expect(preview).toBeNull();
  });
});

describe("POST /api/events/:id/stakes-preview", () => {
  it("returns the preview for a Season participant", async () => {
    const { event, season } = await seedSeason();
    const users = await seedMembers(event.id, season.id, [
      { name: "Ana", crew: "Sharks", rating: 1100 },
      { name: "Bia", crew: "Sharks", rating: 1000 },
    ]);
    mockGetSession.mockResolvedValue({ user: { id: users.get("Ana")!.userId } });

    const res = await postStakes(context({ id: event.id }, { teamOne: ["Ana"], teamTwo: ["Bia"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(true);
    expect(body.preview.scenarios).toHaveLength(3);
  });

  it("403s a non-participant", async () => {
    const { event, season } = await seedSeason();
    await seedMembers(event.id, season.id, [{ name: "Ana" }]);
    await prisma.user.create({ data: { id: "u-outsider", name: "Hacker", email: "h@test" } });
    mockGetSession.mockResolvedValue({ user: { id: "u-outsider" } });

    const res = await postStakes(context({ id: event.id }, { teamOne: ["Ana"], teamTwo: ["Bia"] }));
    expect(res.status).toBe(403);
  });

  it("401s an anonymous caller", async () => {
    const { event, season } = await seedSeason();
    await seedMembers(event.id, season.id, [{ name: "Ana" }]);
    mockGetSession.mockResolvedValue(null);

    const res = await postStakes(context({ id: event.id }, { teamOne: ["Ana"], teamTwo: ["Bia"] }));
    expect(res.status).toBe(401);
  });

  it("reports active:false when there is no active Season", async () => {
    const { event } = await seedSeason({ active: false });
    mockGetSession.mockResolvedValue({ user: { id: "u-x" } });
    const res = await postStakes(context({ id: event.id }, { teamOne: ["Ana"], teamTwo: ["Bia"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).active).toBe(false);
  });

  it("400s on a malformed lineup body", async () => {
    const { event, season } = await seedSeason();
    const users = await seedMembers(event.id, season.id, [{ name: "Ana" }]);
    mockGetSession.mockResolvedValue({ user: { id: users.get("Ana")!.userId } });

    const res = await postStakes(context({ id: event.id }, { teamOne: [], teamTwo: ["Bia"] }));
    expect(res.status).toBe(400);
  });
});
