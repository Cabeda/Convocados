/**
 * Two TeamResults can share a name inside one event: neither event creation
 * (`src/pages/api/events/index.ts`) nor the team-name editor
 * (`src/pages/api/events/[id]/team-names.ts`) checks that the two names
 * differ, and the manual save accepts whatever names the client sends.
 *
 * Keying `reconcileFormations`' write-back by name collapses such a pair, so
 * one membership change stamps the twin's formation and slot layout onto the
 * other team — the label-contradicts-the-split state this module exists to
 * forbid. Position is the safe pairing: `laidOut` is `teams` mapped in place.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { getFormation } from "~/lib/formations";
import { addPlayerToTeams } from "~/lib/teamFormation.server";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const SPORT = "football-5v5";

beforeEach(async () => {
  resetRateLimitStore();
  resetApiRateLimitStore();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

describe("reconcile under duplicate team names", () => {
  it("does not stamp one team's stored formation onto its same-named twin", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Twin names",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        sport: SPORT,
        maxPlayers: 20,
        balanced: false,
        teamOneName: "Red",
        teamTwoName: "Red",
      },
    });

    const a = await prisma.teamResult.create({ data: { name: "Red", eventId: event.id, formation: "2-2" } });
    const b = await prisma.teamResult.create({ data: { name: "Red", eventId: event.id, formation: "1-2-1" } });

    const aNames = ["A1", "A2", "A3", "A4", "A5"];
    for (let i = 0; i < aNames.length; i++) {
      await prisma.teamMember.create({ data: { name: aNames[i], order: i, slot: i, teamResultId: a.id } });
    }
    const bNames = ["B1", "B2", "B3"];
    for (let i = 0; i < bNames.length; i++) {
      await prisma.teamMember.create({ data: { name: bNames[i], order: i, slot: i, teamResultId: b.id } });
    }
    // Roster: every drawn member plus the joiner, all inside the active slice.
    const roster = [...aNames, ...bNames, "Joiner"];
    for (let i = 0; i < roster.length; i++) {
      await prisma.player.create({ data: { name: roster[i], eventId: event.id, order: i } });
    }

    await addPlayerToTeams(event.id, "Joiner");

    const teamA = await prisma.teamResult.findUnique({ where: { id: a.id }, include: { members: { orderBy: { order: "asc" } } } });
    const teamB = await prisma.teamResult.findUnique({ where: { id: b.id }, include: { members: { orderBy: { order: "asc" } } } });

    expect(teamA?.formation, "team A keeps the formation it stores").toBe("2-2");
    expect(teamB?.formation, "team B keeps the formation it stores").toBe("1-2-1");
    expect(teamA?.members.map((m) => m.slot), "team A members keep their slots").toEqual([0, 1, 2, 3, 4]);
    // Every member still sits inside its OWN stored formation.
    for (const team of [teamA, teamB]) {
      const slots = getFormation(SPORT, team!.formation)!.slots.length;
      for (const m of team!.members) {
        expect(m.slot === null || (m.slot! >= 0 && m.slot! < slots), `${team!.formation} slot ${m.slot} for ${m.name}`).toBe(true);
      }
    }
    // The joiner landed on the smaller team, honestly placed or unplaced.
    expect(teamB?.members.some((m) => m.name === "Joiner")).toBe(true);
  });
});
