/**
 * Teams + bench must never include pending invite ghosts (ADR 0025).
 *
 * A pending GameParticipant (status="pending") is an invited-but-not-yet-accepted
 * player. They must not appear on team/unassigned/bench listings, and they must
 * not inflate the active count such that a real player gets pushed to the bench.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

import { GET as getTeams } from "~/pages/api/events/[id]/teams";

function req(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

async function seedTeamScenario(maxPlayers = 2) {
  const event = await prisma.event.create({
    data: {
      title: "Ninjas",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      maxPlayers,
    },
  });

  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

  const luis = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Luís" } });
  const ana = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Ana" } });
  const pedro = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Pedro" } });
  const invited = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Marta (invited)" } });

  // Two active players fill both active spots; one pending invite ghost.
  await prisma.gameParticipant.createMany({
    data: [
      { gameId: game.id, eventPlayerId: luis.id, order: 0, status: "active" },
      { gameId: game.id, eventPlayerId: ana.id, order: 1, status: "active" },
      { gameId: game.id, eventPlayerId: pedro.id, order: 2, status: "active" },
      { gameId: game.id, eventPlayerId: invited.id, order: 3, status: "pending" },
    ],
  });

  // Assign the two active (order 0,1) players to teams so the response has
  // meaningful teamOne/teamTwo arrays and a bench that should NOT contain Marta.
  await prisma.teamResult.createMany({
    data: [
      { name: "Ninjas", eventId: event.id },
      { name: "Gunas", eventId: event.id },
    ],
  });
  const teams = await prisma.teamResult.findMany({ where: { eventId: event.id }, orderBy: { id: "asc" } });
  await prisma.teamMember.createMany({
    data: [
      { name: "Luís", order: 0, teamResultId: teams[0].id },
      { name: "Ana", order: 0, teamResultId: teams[1].id },
    ],
  });

  return { eventId: event.id, gameId: game.id };
}

beforeEach(async () => {
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.game.deleteMany();
  await prisma.playerInvite.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("GET /api/events/[id]/teams excludes pending invitees", () => {
  it("does not include a pending invitee in teamOne/teamTwo/unassigned/bench", async () => {
    const { eventId } = await seedTeamScenario();
    const res = await getTeams(req({ id: eventId }));
    expect(res.status).toBe(200);
    const body = await res.json();

    const allNames = [
      ...body.teamOne.players.map((p: { name: string }) => p.name),
      ...body.teamTwo.players.map((p: { name: string }) => p.name),
      ...body.unassigned.map((p: { name: string }) => p.name),
      ...body.bench.map((p: { name: string }) => p.name),
    ];
    expect(allNames).not.toContain("Marta (invited)");
  });

  it("does not push a real player onto the bench because of a pending invitee", async () => {
    const { eventId } = await seedTeamScenario(); // maxPlayers = 2, 3 active + 1 pending
    const res = await getTeams(req({ id: eventId }));
    const body = await res.json();

    // With 2 active slots and 3 active players, "Pedro" (order 2) benches.
    // The pending Marta must NOT be the one benched, and must not appear at all.
    const benchNames = body.bench.map((p: { name: string }) => p.name);
    expect(benchNames).toContain("Pedro");
    expect(benchNames).not.toContain("Marta (invited)");
    expect(body.bench).toHaveLength(1);
  });
});
