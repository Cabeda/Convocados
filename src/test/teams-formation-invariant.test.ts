/**
 * Invariant: the teams panel must never render a formation label that
 * contradicts the actual split.
 *
 * Production evidence (event cmmkfrx8b0000o2ixrix1yp2m, Ninjas da Areosa):
 * the 9th joiner was appended onto an existing draw, the stored `formation`
 * was never reconciled and the new member was written with `slot: null` — the
 * persisted row stopped describing the team, and the view papered over it with
 * a client-side `normalizeSlots` guess.
 *
 * These tests pin the invariant at the source: after ANY membership change on
 * a generated draw, every team's stored `formation` must resolve to a
 * formation of the event's sport and every member must sit in a slot of it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { getFormation } from "~/lib/formations";
import { addPlayerToTeams, validateTeams } from "~/lib/teamFormation.server";
import { POST as addPlayer } from "~/pages/api/events/[id]/players";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const SPORT = "football-5v5";
const SLOTS = getFormation(SPORT, "2-2")!.slots.length; // 5

function ctx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

async function seedEventWithGame(maxPlayers: number) {
  const event = await prisma.event.create({
    data: {
      title: "Ninjas da Areosa",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      sport: SPORT,
      isRecurring: true,
      recurrenceRule: "FREQ=WEEKLY",
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { event, gameId: game.id };
}

async function seedActiveParticipant(gameId: string, eventId: string, name: string, order: number) {
  const ep = await prisma.eventPlayer.create({ data: { eventId, name } });
  await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: ep.id, order } });
}

/** A draw made earlier, with every member placed on the stored formation. */
async function seedDrawnTeams(eventId: string, split: Record<string, string[]>) {
  for (const [teamName, names] of Object.entries(split)) {
    const team = await prisma.teamResult.create({
      data: { name: teamName, eventId, formation: "2-2" },
    });
    for (let i = 0; i < names.length; i++) {
      await prisma.teamMember.create({ data: { name: names[i], order: i, slot: i, teamResultId: team.id } });
    }
  }
}

async function seedTeamWithSlots(eventId: string, teamName: string, members: [string, number | null][]) {
  const team = await prisma.teamResult.create({ data: { name: teamName, eventId, formation: "2-2" } });
  await Promise.all(members.map(([n, slot], i) => prisma.teamMember.create({ data: { name: n, order: i, slot, teamResultId: team.id } })));
}

async function loadTeams(eventId: string) {
  return prisma.teamResult.findMany({
    where: { eventId },
    include: { members: { orderBy: { order: "asc" } } },
  });
}

beforeEach(async () => {
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.notificationJob.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.player.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("teams panel invariant: the stored formation always describes the split", () => {
  it("a 9th joiner lands in a slot of the team's formation instead of leaving the row unplaced", async () => {
    const { event, gameId } = await seedEventWithGame(10);

    // Eight live players, already drawn 4v4 on a 2-2 (5 slots) formation
    for (let i = 0; i < 8; i++) {
      await seedActiveParticipant(gameId, event.id, `Player ${i + 1}`, i);
    }
    await seedDrawnTeams(event.id, {
      Ninjas: ["Player 1", "Player 2", "Player 3", "Player 4"],
      Gunas: ["Player 5", "Player 6", "Player 7", "Player 8"],
    });

    // The 9th joiner (order 8 < maxPlayers 10) takes the "on active" branch
    const res = await addPlayer(ctx({ id: event.id }, { name: "Player 9" }));
    expect(res.status).toBe(200);

    const teams = await loadTeams(event.id);
    expect(teams).toHaveLength(2);
    const memberNames = teams.flatMap((t) => t.members.map((m) => m.name));
    expect(memberNames.sort()).toEqual(
      ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6", "Player 7", "Player 8", "Player 9"].sort(),
    );

    // The label still names a formation of this sport, and it can hold the team
    for (const team of teams) {
      const formation = getFormation(SPORT, team.formation);
      expect(formation, `team ${team.name} formation ${team.formation}`).toBeDefined();
      expect(team.members.length).toBeLessThanOrEqual(formation!.slots.length);
    }

    // Every member sits in a slot of that formation — the row describes the team
    for (const team of teams) {
      const slots = team.members.map((m) => m.slot);
      expect(slots, `team ${team.name} slots`).toEqual(expect.arrayContaining([expect.any(Number)]));
      for (const slot of slots) {
        expect(typeof slot).toBe("number");
        expect(slot!).toBeGreaterThanOrEqual(0);
        expect(slot!).toBeLessThan(SLOTS);
      }
      expect(new Set(slots).size).toBe(team.members.length);
    }
  });

  it("stamps the sport's default formation on teams that have none, and places the joiner in it", async () => {
    const { event, gameId } = await seedEventWithGame(10);

    for (let i = 0; i < 8; i++) {
      await seedActiveParticipant(gameId, event.id, `Player ${i + 1}`, i);
    }
    // Legacy draw written before formations existed: formation is null
    const ninjas = await prisma.teamResult.create({ data: { name: "Ninjas", eventId: event.id } });
    const gunas = await prisma.teamResult.create({ data: { name: "Gunas", eventId: event.id } });
    for (let i = 0; i < 4; i++) {
      await prisma.teamMember.create({ data: { name: `Player ${i + 1}`, order: i, teamResultId: ninjas.id } });
      await prisma.teamMember.create({ data: { name: `Player ${i + 5}`, order: i, teamResultId: gunas.id } });
    }

    const res = await addPlayer(ctx({ id: event.id }, { name: "Player 9" }));
    expect(res.status).toBe(200);

    const teams = await loadTeams(event.id);
    for (const team of teams) {
      expect(team.formation).toBe("2-2");
      for (const member of team.members) {
        expect(typeof member.slot).toBe("number");
        expect(member.slot!).toBeLessThan(SLOTS);
      }
    }
  });

  it("never draws a player from outside the active slice onto the pitch", async () => {
    const { event, gameId } = await seedEventWithGame(10);

    // 12 live players: 10 active, 2 on the bench
    for (let i = 0; i < 12; i++) {
      await seedActiveParticipant(gameId, event.id, `Player ${i + 1}`, i);
    }
    await seedDrawnTeams(event.id, {
      Ninjas: ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5"],
      Gunas: ["Player 6", "Player 7", "Player 8", "Player 9", "Player 10"],
    });

    // Bench joiner: the roster is full, so no team may absorb them
    await addPlayerToTeams(event.id, "Player 11", event.currentGameId);

    const teams = await loadTeams(event.id);
    expect(teams.map((t) => t.members.length).sort()).toEqual([5, 5]);
    const names = teams.flatMap((t) => t.members.map((m) => m.name));
    expect(names).not.toContain("Player 11");

    // And nothing about the stored layout drifted
    for (const team of teams) {
      expect(team.formation).toBe("2-2");
      expect(new Set(team.members.map((m) => m.slot)).size).toBe(5);
    }
  });

  it("leaves members beyond the formation's slots honestly unplaced rather than inventing a slot", async () => {
    const { event, gameId } = await seedEventWithGame(10);

    for (let i = 0; i < 10; i++) {
      await seedActiveParticipant(gameId, event.id, `Player ${i + 1}`, i);
    }
    // One team carries six members under a five-slot formation (legacy/manual
    // state) — the overflow must stay visibly unplaced, never silently fitted.
    await seedDrawnTeams(event.id, {
      Ninjas: ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"],
      Gunas: ["Player 7", "Player 8", "Player 9"],
    });

    // Player 10 is in the active slice and joins the smaller team
    await addPlayerToTeams(event.id, "Player 10", event.currentGameId);

    const teams = await loadTeams(event.id);
    const ninjas = teams.find((t) => t.name === "Ninjas")!;
    const gunas = teams.find((t) => t.name === "Gunas")!;

    expect(ninjas.formation).toBe("2-2");
    expect(ninjas.members.filter((m) => m.slot !== null)).toHaveLength(SLOTS);
    expect(ninjas.members.filter((m) => m.slot === null)).toHaveLength(1);
    expect(gunas.members.every((m) => typeof m.slot === "number")).toBe(true);
    expect(gunas.members.map((m) => m.slot).sort()).toEqual([0, 1, 2, 3]);
  });

  it("places every member of its own team when a display name is shared across teams", async () => {
    const { event, gameId } = await seedEventWithGame(10);
    await seedActiveParticipant(gameId, event.id, "Player 9", 0);
    // Three member rows share the display name "Rui" across the two teams.
    await seedTeamWithSlots(event.id, "Ninjas", [["Rui", 3], ["Rui", null]]);
    await seedTeamWithSlots(event.id, "Gunas", [["Rui", null]]);
    await addPlayerToTeams(event.id, "Player 9", gameId);
    // Nobody is left unplaced, and no two members of a team share a slot.
    for (const team of await loadTeams(event.id)) {
      expect(team.members.every((m) => typeof m.slot === "number" && m.slot! < SLOTS), team.name).toBe(true);
      expect(new Set(team.members.map((m) => m.slot)).size, team.name).toBe(team.members.length);
    }
  });

  it("re-derives the layout after validateTeams evicts an off-roster member", async () => {
    const { event, gameId } = await seedEventWithGame(10);
    await Promise.all(Array.from({ length: 12 }, (_, i) => seedActiveParticipant(gameId, event.id, `Player ${i + 1}`, i)));
    // A draw from a larger split: the 9th joiner sits unplaced, Player 11 fell off the active slice.
    await seedTeamWithSlots(event.id, "Ninjas", [["Player 1", 0], ["Player 2", 1], ["Player 3", 2], ["Player 4", 3], ["Player 5", null]]);
    await seedTeamWithSlots(event.id, "Gunas", [["Player 6", 0], ["Player 7", 1], ["Player 8", 2], ["Player 9", 3], ["Player 11", 4]]);
    expect(await validateTeams(event.id, event.maxPlayers, gameId)).toBe(true);
    const teams = await loadTeams(event.id);
    expect(teams.every((t) => getFormation(SPORT, t.formation) !== undefined)).toBe(true);
    expect(teams.flatMap((t) => t.members).every((m) => typeof m.slot === "number" && m.slot! < SLOTS)).toBe(true);
    expect(teams.flatMap((t) => t.members).filter((m) => m.name === "Player 11")).toHaveLength(0);
  });

  it("keeps the invariant through a balanced rebalance, where the draw is rebuilt wholesale", async () => {
    const { event, gameId } = await seedEventWithGame(10);
    await Promise.all(Array.from({ length: 10 }, (_, i) => seedActiveParticipant(gameId, event.id, `Player ${i + 1}`, i)));
    await seedTeamWithSlots(event.id, "Ninjas", [["Player 1", 0], ["Player 2", 1], ["Player 3", 2], ["Player 4", 3], ["Player 5", null]]);
    await seedTeamWithSlots(event.id, "Gunas", [["Player 6", 0], ["Player 7", 1], ["Player 8", 2], ["Player 9", 3], ["Player 10", 4]]);
    await prisma.event.update({ where: { id: event.id }, data: { balanced: true } });

    // The balanced branch throws the draw away and rebuilds it from ratings, so
    // the formed-out invariant has to survive a path that never saw the old
    // layout at all.
    await addPlayerToTeams(event.id, "Player 10");

    const teams = await loadTeams(event.id);
    expect(teams).toHaveLength(2);
    expect(teams.every((t) => getFormation(SPORT, t.formation) !== undefined)).toBe(true);
    const all = teams.flatMap((t) => t.members);
    expect(all).toHaveLength(10);
    // The balanced rebuild creates members with no slot at all; the reconcile
    // that follows it is what places them. Without it every member of the draw
    // would sit here as slot: null, so this assertion is the wiring.
    expect(all.filter((m) => m.slot === null)).toEqual([]);
    for (const t of teams) {
      const placed = t.members.flatMap((m) => (typeof m.slot === "number" ? [m.slot] : []));
      expect(placed.every((s) => s < SLOTS)).toBe(true);
      expect(new Set(placed).size).toBe(placed.length);
    }
  });
});
