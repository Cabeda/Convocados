/**
 * Regression: undo-remove must put the restored player back on the draw.
 *
 * The route restores the leaver's GameParticipant before re-syncing teams;
 * addPlayerToTeams derives the active slice from those participants, so the
 * team sync has to run after that restore or the leaver is still archived and
 * the add silently no-ops — the roster shows them, the draw does not.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { POST as undoRemove } from "~/pages/api/events/[id]/undo-remove";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

function ctx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
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
  await prisma.eventFollow.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("undo-remove restores the player onto their team", () => {
  it("puts the undone player back on the draw on a game-scoped roster", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Ninjas da Areosa",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        maxPlayers: 10,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        sport: "football-5v5",
      },
    });
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
    });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

    const names = ["Alice", "Bob", "Charlie", "Dave"];
    const eps: Record<string, string> = {};
    for (let i = 0; i < names.length; i++) {
      const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: names[i] } });
      eps[names[i]] = ep.id;
      await prisma.gameParticipant.create({
        data: { gameId: game.id, eventPlayerId: ep.id, order: i, status: "active" },
      });
    }

    const ninjas = await prisma.teamResult.create({
      data: { name: "Ninjas", eventId: event.id, formation: "2-2" },
    });
    const gunas = await prisma.teamResult.create({
      data: { name: "Gunas", eventId: event.id, formation: "2-2" },
    });
    await prisma.teamMember.create({ data: { name: "Alice", order: 0, slot: 0, teamResultId: ninjas.id } });
    await prisma.teamMember.create({ data: { name: "Charlie", order: 1, slot: 1, teamResultId: ninjas.id } });
    await prisma.teamMember.create({ data: { name: "Dave", order: 0, slot: 0, teamResultId: gunas.id } });

    // Simulate the removal of Bob (archiveAndLeave): participant archived, member evicted.
    await prisma.gameParticipant.updateMany({
      where: { gameId: game.id, eventPlayerId: eps.Bob },
      data: { archivedAt: new Date() },
    });
    await prisma.teamMember.deleteMany({ where: { teamResultId: { in: [ninjas.id, gunas.id] }, name: "Bob" } });
    await prisma.rsvp.upsert({
      where: { eventPlayerId_gameId: { eventPlayerId: eps.Bob, gameId: game.id } },
      create: { eventPlayerId: eps.Bob, gameId: game.id, status: "no", respondedAt: new Date() },
      update: { status: "no", respondedAt: new Date() },
    });

    const res = await undoRemove(ctx({ id: event.id }, { name: "Bob", order: 1, userId: null, removedAt: Date.now() }));
    expect(res.status).toBe(200);

    // Roster restored...
    const gp = await prisma.gameParticipant.findFirst({
      where: { gameId: game.id, eventPlayerId: eps.Bob },
    });
    expect(gp?.archivedAt).toBeNull();

    // ...and the draw restored: Bob must be back on a team.
    const members = await prisma.teamMember.findMany({
      where: { team: { eventId: event.id } },
    });
    expect(members.map((m) => m.name).sort()).toEqual(["Alice", "Bob", "Charlie", "Dave"].sort());
  });
});
