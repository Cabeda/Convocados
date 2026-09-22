import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { movePlayerToEndOfList, rejoinPlayerToCurrentGame } from "~/lib/rosterChange.server";

let eventId = "";

beforeEach(async () => {
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();

  const event = await prisma.event.create({
    data: { title: "Roster", location: "P", dateTime: new Date(), teamOneName: "A", teamTwoName: "B" },
  });
  eventId = event.id;
});

describe("movePlayerToEndOfList", () => {
  it("moves a player after the current last active order", async () => {
    const first = await prisma.player.create({ data: { eventId, name: "First", order: 0 } });
    await prisma.player.create({ data: { eventId, name: "Second", order: 1 } });

    const order = await movePlayerToEndOfList(eventId, first.id);
    expect(order).toBe(2);
    const updated = await prisma.player.findUnique({ where: { id: first.id } });
    expect(updated?.order).toBe(2);
  });

  it("un-archives when reactivate is set", async () => {
    const p = await prisma.player.create({
      data: { eventId, name: "Gone", order: 0, archivedAt: new Date() },
    });
    await movePlayerToEndOfList(eventId, p.id, { reactivate: true });
    expect((await prisma.player.findUnique({ where: { id: p.id } }))?.archivedAt).toBeNull();
  });

  it("links an account when linkUserId is set", async () => {
    const user = await prisma.user.create({
      data: { id: `u-${Date.now()}`, name: "U", email: `u-${Date.now()}@test.com`, emailVerified: false },
    });
    const p = await prisma.player.create({ data: { eventId, name: "Anon", order: 0 } });
    await movePlayerToEndOfList(eventId, p.id, { linkUserId: user.id });
    expect((await prisma.player.findUnique({ where: { id: p.id } }))?.userId).toBe(user.id);
    await prisma.user.delete({ where: { id: user.id } });
  });
});

describe("rejoinPlayerToCurrentGame", () => {
  it("activates an archived GameParticipant and resets Attendance to yes", async () => {
    const game = await prisma.game.create({ data: { eventId, dateTime: new Date(), status: "upcoming" } });
    const ep = await prisma.eventPlayer.create({ data: { eventId, name: "Rejoiner" } });
    await prisma.gameParticipant.create({
      data: { gameId: game.id, eventPlayerId: ep.id, order: 0, status: "active", archivedAt: new Date() },
    });
    await prisma.rsvp.create({
      data: { eventPlayerId: ep.id, gameId: game.id, status: "no" },
    });

    await rejoinPlayerToCurrentGame(game.id, ep.id);

    const gp = await prisma.gameParticipant.findUnique({
      where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: ep.id } },
    });
    expect(gp?.archivedAt).toBeNull();
    expect(gp?.status).toBe("active");

    const rsvp = await prisma.rsvp.findUnique({
      where: { eventPlayerId_gameId: { eventPlayerId: ep.id, gameId: game.id } },
    });
    expect(rsvp?.status).toBe("yes");
  });
});
