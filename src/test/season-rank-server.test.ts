import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  deriveSeasonRank,
  ensureRankCalibration,
  getSeasonRankPayload,
  snapshotSeasonRank,
} from "~/lib/seasonRank.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

beforeEach(async () => {
  await prisma.seasonRankSnapshot.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.season.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

async function seed() {
  const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@test" } });
  const event = await prisma.event.create({
    data: { title: "T", location: "L", dateTime: new Date("2026-01-01T00:00:00Z"), maxPlayers: 10, ownerId: owner.id, eloEnabled: true, rankEnabled: true },
  });
  const names = ["A", "B", "C", "D"];
  for (const [i, n] of names.entries()) {
    await prisma.playerRating.create({ data: { eventId: event.id, name: n, rating: 1000 + i * 50, gamesPlayed: 5 } });
  }
  const season = await prisma.season.create({
    data: { eventId: event.id, name: "S1", registrationOpensAt: new Date("2026-01-01T00:00:00Z"), registrationClosesAt: new Date("2026-02-01T00:00:00Z"), status: "active" },
  });
  for (const n of names) {
    const u = await prisma.user.create({ data: { id: `u-${n}`, name: n, email: `${n}@test` } });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: n, userId: u.id } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: ep.id, userId: u.id, status: "active" } });
  }
  const games = [
    { day: 2, one: ["A"], two: ["B"], s1: 1, s2: 0 },
    { day: 3, one: ["A"], two: ["C"], s1: 1, s2: 0 },
  ];
  for (const g of games) {
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(`2026-01-0${g.day}T00:00:00Z`),
        status: "played",
        isFriendly: false,
        scoreOne: g.s1,
        scoreTwo: g.s2,
        teamOneName: "T1",
        teamTwoName: "T2",
        teamsSnapshot: JSON.stringify([
          { team: "T1", players: g.one.map((n, o) => ({ name: n, order: o })) },
          { team: "T2", players: g.two.map((n, o) => ({ name: n, order: o })) },
        ]),
      },
    });
  }
  return { event, season };
}

describe("seasonRank.server", () => {
  it("derives a frozen calibration (anchor + 6 edges) idempotently", async () => {
    const { event } = await seed();
    const first = await ensureRankCalibration(event.id);
    expect(first.anchor).toBe(1000); // min established skill
    expect(first.edges.length).toBe(6);
    expect(first.edges[0]).toBe(0);

    const second = await ensureRankCalibration(event.id);
    expect(second).toEqual(first);
  });

  it("replays the season and ranks winners higher", async () => {
    const { event, season } = await seed();
    const payload = await deriveSeasonRank(event.id, season.id);
    expect(payload).not.toBeNull();
    const byName = new Map(payload!.players.map((p) => [p.name, p]));
    expect(payload!.gamesCount).toBe(2);
    // anchor = 1000 -> seeds A=0, B=50, C=100, D=150.
    expect(byName.get("A")!.hidden).toBeGreaterThan(0); // won both, gained
    expect(byName.get("B")!.hidden).toBeLessThan(50); // lost, dropped below seed
    expect(byName.get("C")!.hidden).toBeLessThan(100); // lost, dropped below seed
    expect(byName.get("D")!.hidden).toBe(150); // never played, untouched
  });

  it("freezes a completion snapshot and serves it back", async () => {
    const { event, season } = await seed();
    await snapshotSeasonRank(event.id, season.id);
    const snap = await prisma.seasonRankSnapshot.findUnique({ where: { seasonId: season.id } });
    expect(snap).not.toBeNull();

    // A later game must NOT change the frozen payload.
    await prisma.gameHistory.create({
      data: {
        eventId: event.id, dateTime: new Date("2026-01-09T00:00:00Z"), status: "played", isFriendly: false,
        scoreOne: 0, scoreTwo: 1,
        teamOneName: "T1", teamTwoName: "T2",
        teamsSnapshot: JSON.stringify([
          { team: "T1", players: [{ name: "A", order: 0 }] },
          { team: "T2", players: [{ name: "B", order: 0 }] },
        ]),
      },
    });
    const frozen = await getSeasonRankPayload(event.id, season.id);
    const live = await deriveSeasonRank(event.id, season.id);
    const frozenA = frozen!.players.find((p) => p.name === "A")!;
    const liveA = live!.players.find((p) => p.name === "A")!;
    expect(frozenA.hidden).toBeGreaterThan(liveA.hidden); // A lost the extra game live
  });
});
