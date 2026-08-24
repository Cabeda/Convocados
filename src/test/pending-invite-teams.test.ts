/**
 * Regression test: pending invite GameParticipants ("roster ghosts", ADR 0025)
 * must not pollute the join path's roster math. When a pending invite occupies
 * a queue slot, getActiveRosterState counted it toward maxPlayers — joins were
 * misclassified as "bench" and team sync (addPlayerToTeams/autoRandomizeIfFull)
 * silently skipped, leaving stale teams when the game filled (#Ninjas da Areosa,
 * 2026-08-24: 10/10 players, teams frozen at a 7-player split).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { POST as addPlayer } from "~/pages/api/events/[id]/players";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

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

async function seedPendingInvite(gameId: string, eventId: string, name: string, order: number) {
  const ep = await prisma.eventPlayer.create({ data: { eventId, name } });
  // Mirrors createPlayerInvite: pending invites hold an archivedAt=null GP row
  await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: ep.id, order, status: "pending" } });
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

describe("join path ignores pending invite ghosts when syncing teams", () => {
  it("generates teams when the final active spot fills despite a pending invite", async () => {
    const { event, gameId } = await seedEventWithGame(4);

    // 3 of 4 spots taken by real players
    for (let i = 0; i < 3; i++) {
      await seedActiveParticipant(gameId, event.id, `Player ${i + 1}`, i);
    }
    // Pending invite sits between them in the queue
    await seedPendingInvite(gameId, event.id, "Invited Guest", 2);

    // The join that fills the game (4th active spot)
    const res = await addPlayer(ctx({ id: event.id }, { name: "Player 4" }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const teams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: true },
    });

    // Auto-randomize must have fired: two teams covering all four REAL players
    expect(teams).toHaveLength(2);
    const memberNames = teams.flatMap((t) => t.members.map((m) => m.name));
    expect(memberNames).toHaveLength(4);
    expect(memberNames).toEqual(expect.arrayContaining(["Player 1", "Player 2", "Player 3", "Player 4"]));
    expect(memberNames).not.toContain("Invited Guest");
  });

  it("pending invites do not consume active slots or shift joins onto the bench", async () => {
    const { event, gameId } = await seedEventWithGame(3);

    await seedActiveParticipant(gameId, event.id, "Player 1", 0);
    await seedActiveParticipant(gameId, event.id, "Player 2", 1);
    // Invites were sent afterwards — their ghost rows sit at the end of the queue
    await seedPendingInvite(gameId, event.id, "Invited A", 5);
    await seedPendingInvite(gameId, event.id, "Invited B", 6);

    // Fills the last ACTIVE spot (with the bug, the two ghosts made this a "bench" join)
    const res3 = await addPlayer(ctx({ id: event.id }, { name: "Player 3" }));
    expect(res3.status).toBe(200);

    // Next joiner must land on the bench — the game is genuinely full now
    const res4 = await addPlayer(ctx({ id: event.id }, { name: "Player 4" }));
    expect(res4.status).toBe(200);

    const gps = await prisma.gameParticipant.findMany({
      where: { gameId, archivedAt: null },
      include: { eventPlayer: { select: { name: true } } },
    });
    const orderByPlayerName = new Map(gps.map((gp) => [gp.eventPlayer.name, gp.order]));

    expect(orderByPlayerName.get("Player 3")).toBe(2); // active slot, not shifted past the ghosts
    expect(orderByPlayerName.get("Player 4")).toBeGreaterThanOrEqual(3); // bench

    // And filling the game generated teams for exactly the three active players
    const teams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: true },
    });
    expect(teams).toHaveLength(2);
    const memberNames = teams.flatMap((t) => t.members.map((m) => m.name)).sort();
    expect(memberNames).toEqual(["Player 1", "Player 2", "Player 3"]);
  });

  it("joins into an already-generated roster still reach the teams when a ghost is queued", async () => {
    const { event, gameId } = await seedEventWithGame(5);

    // Teams were generated earlier with four players (3 Ninjas vs 1 Gunas)
    const ninjas = await prisma.teamResult.create({ data: { name: "Ninjas", eventId: event.id } });
    const gunas = await prisma.teamResult.create({ data: { name: "Gunas", eventId: event.id } });
    for (const [team, names] of [[ninjas, ["Player 1", "Player 2", "Player 3"]], [gunas, ["Player 4"]]] as const) {
      for (let i = 0; i < names.length; i++) {
        await seedActiveParticipant(gameId, event.id, names[i], i);
        await prisma.teamMember.create({ data: { name: names[i], order: i, teamResultId: team.id } });
      }
    }
    await seedPendingInvite(gameId, event.id, "Invited Guest", 4);

    // Fifth ACTIVE spot fills — must be added to the smaller team (non-balanced mode)
    const res = await addPlayer(ctx({ id: event.id }, { name: "Player 5" }));
    expect(res.status).toBe(200);

    const members = await prisma.teamMember.findMany({
      where: { team: { eventId: event.id } },
    });
    const names = members.map((m) => m.name);
    expect(names).toContain("Player 5");
    expect(names.filter((n) => n === "Player 5")).toHaveLength(1);
    expect(names).not.toContain("Invited Guest");
  });
});
