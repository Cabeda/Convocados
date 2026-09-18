/**
 * Guaranteed "Ninjas da Areosa" Season scenario for the admin Season demo.
 *
 * Recreates the shape of the real Ninjas event: a live football-5v5 game with a
 * full roster, Ninjas/Gunas teams, past results and ratings, plus ONE Season in
 * the `active` lifecycle state.
 *
 * The active Season's registration window is intentionally wide (a year back,
 * two years forward) so that creating any new Season for this event overlaps it
 * and the API rejects the request — reproducing the "cannot create a new Season
 * because the running one can never be completed" bug.
 *
 * All names, emails, and locations are randomly generated with faker — no real
 * personal data.
 *
 * Called from prisma/seed.ts; not a standalone script.
 */
import type { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";

const DAY = 86_400_000;
const PARTICIPANT_COUNT = 10;
const GAME_COUNT = 6;

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
}

/** Deterministic rotating 5-a-side lineups: everyone plays, sides shift weekly. */
function lineupsFor(gameIndex: number, names: string[]): [string[], string[]] {
  const shift = gameIndex % names.length;
  const rotated = [...names.slice(shift), ...names.slice(0, shift)];
  const teamOne: string[] = [];
  const teamTwo: string[] = [];
  rotated.forEach((name, i) => (i % 2 === 0 ? teamOne : teamTwo).push(name));
  return [teamOne, teamTwo];
}

export async function seedNinjasSeason(
  prisma: PrismaClient,
  demoUser: { id: string; email: string },
  now: number,
): Promise<void> {
  const usedNames = new Set<string>();
  const participants = Array.from({ length: PARTICIPANT_COUNT }, (_, i) => {
    let name = faker.person.firstName();
    while (usedNames.has(name)) name = `${faker.person.firstName()} ${faker.string.alpha({ length: 1, casing: "upper" })}.`;
    usedNames.add(name);
    return { name, rating: 1320 - i * 28 + faker.number.int({ min: -15, max: 15 }) };
  });

  // Live now: kicked off 20 minutes ago in a 60-minute game.
  const event = await prisma.event.create({
    data: {
      title: "Ninjas da Areosa",
      location: "Campo da Areosa, Porto",
      latitude: 41.1579,
      longitude: -8.6291,
      dateTime: new Date(now - 20 * 60 * 1000),
      maxPlayers: PARTICIPANT_COUNT,
      durationMinutes: 60,
      sport: "football-5v5",
      isPublic: true,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId: demoUser.id,
      eloEnabled: true,
      balanced: true,
      showCompetitiveData: true,
    },
  });

  const eventPlayerByName = new Map<string, string>();
  const userByName = new Map<string, string>();
  for (const [order, p] of participants.entries()) {
    const email = faker.internet.email({ firstName: slugify(p.name) || "player", provider: "demo.convocados.test" }).toLowerCase();
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { id: `demo-ninjas-${faker.string.uuid()}`, name: p.name, email, emailVerified: true },
    });
    userByName.set(p.name, user.id);
    // Legacy roster (drives the event page player list).
    await prisma.player.create({ data: { eventId: event.id, name: p.name, order, userId: user.id } });
    // ADR 0016 roster (drives Seasons/Crews).
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: p.name, userId: user.id, rating: p.rating } });
    eventPlayerByName.set(p.name, ep.id);
    await prisma.playerRating.create({
      data: {
        eventId: event.id,
        name: p.name,
        userId: user.id,
        rating: p.rating,
        gamesPlayed: GAME_COUNT,
        wins: faker.number.int({ min: 1, max: GAME_COUNT - 1 }),
        losses: faker.number.int({ min: 0, max: 3 }),
      },
    });
  }

  const names = participants.map((p) => p.name);
  for (let i = 0; i < GAME_COUNT; i++) {
    const [teamOne, teamTwo] = lineupsFor(i, names);
    const scoreOne = faker.number.int({ min: 0, max: 6 });
    const scoreTwo = faker.number.int({ min: 0, max: 6 });
    const teamsSnapshot = JSON.stringify([
      { team: "Ninjas", players: teamOne.map((name, order) => ({ name, order })) },
      { team: "Gunas", players: teamTwo.map((name, order) => ({ name, order })) },
    ]);
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(now - (GAME_COUNT - i) * 7 * DAY),
        status: "played",
        isFriendly: false,
        scoreOne,
        scoreTwo,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        teamsSnapshot,
        source: "historical",
        eloProcessed: true,
      },
    });
  }

  // Current teams so the live event page renders Ninjas vs Gunas.
  const half = Math.floor(names.length / 2);
  const teamOneNames = names.slice(0, half);
  const teamTwoNames = names.slice(half);
  await prisma.teamResult.create({
    data: { name: "Ninjas", eventId: event.id, members: { create: teamOneNames.map((name, order) => ({ name, order })) } },
  });
  await prisma.teamResult.create({
    data: { name: "Gunas", eventId: event.id, members: { create: teamTwoNames.map((name, order) => ({ name, order })) } },
  });

  // The running Season. Wide window on purpose: any new Season overlaps it, so
  // the create endpoint rejects until this one is completed.
  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: "Season 2026/27",
      status: "active",
      registrationOpensAt: new Date(now - 365 * DAY),
      registrationClosesAt: new Date(now + 730 * DAY),
      activatedAt: new Date(now - 30 * DAY),
      createdByUserId: demoUser.id,
    },
  });

  const membershipByName = new Map<string, string>();
  for (const p of participants) {
    const membership = await prisma.seasonMembership.create({
      data: {
        seasonId: season.id,
        eventPlayerId: eventPlayerByName.get(p.name)!,
        userId: userByName.get(p.name)!,
        status: "active",
        joinedAt: new Date(now - 60 * DAY),
      },
    });
    membershipByName.set(p.name, membership.id);
  }

  const crewOne = await prisma.crew.create({ data: { seasonId: season.id, name: "Ninjas", sortOrder: 0 } });
  const crewTwo = await prisma.crew.create({ data: { seasonId: season.id, name: "Gunas", sortOrder: 1 } });
  for (const name of teamOneNames) {
    await prisma.seasonMembership.update({ where: { id: membershipByName.get(name)! }, data: { crewId: crewOne.id } });
  }
  for (const name of teamTwoNames) {
    await prisma.seasonMembership.update({ where: { id: membershipByName.get(name)! }, data: { crewId: crewTwo.id } });
  }

  console.log(`\n  ** NINJAS SEASON DEMO (active Season / no complete action):`);
  console.log(`     ${event.id}  "${event.title}"  ${PARTICIPANT_COUNT}/${PARTICIPANT_COUNT} players  (live)`);
  console.log(`     ${GAME_COUNT} past games · crews: Ninjas (${teamOneNames.join(", ")}) / Gunas (${teamTwoNames.join(", ")})`);
  console.log(`     Season: "${season.name}"  status=active  window ${new Date(now - 365 * DAY).toISOString().slice(0, 10)} → ${new Date(now + 730 * DAY).toISOString().slice(0, 10)}`);
  console.log(`     Event:   /events/${event.id}`);
  console.log(`     Seasons: /events/${event.id}/seasons`);
  console.log(`     Repro:   Start new Season with any dates → 409 overlap`);
  console.log(`     Sign in: ${demoUser.email} / demo123`);
}
