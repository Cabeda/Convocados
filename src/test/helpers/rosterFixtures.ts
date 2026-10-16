import { prisma } from "~/lib/db.server";

/**
 * Shared Roster seeding for the Roster tests. Two files need the same shape
 * (a recurring Event with a current Game plus GameParticipants); a third copy of it
 * would drift, and the drift always lands in the direction of a weaker assertion.
 */

/** A recurring Event with a current (upcoming) Game — ADR 0016 game-scoped Roster. */
export async function seedRecurringEvent(maxPlayers: number) {
  const event = await prisma.event.create({
    data: {
      title: "Ninjas da Areosa",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers,
      isRecurring: true,
      recurrenceRule: "FREQ=WEEKLY",
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

/** Add one member to the current Game's Roster at `order`. */
export async function addGameParticipant(
  gameId: string,
  eventId: string,
  name: string,
  order: number,
  archivedAt: Date | null = null,
  status: string = "active",
) {
  const ep = await prisma.eventPlayer.create({ data: { eventId, name } });
  await prisma.gameParticipant.create({
    data: { gameId, eventPlayerId: ep.id, order, archivedAt, status },
  });
}

/** Empty every Roster table so each test starts from one clean Event. */
export async function clearRosterTables() {
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
}