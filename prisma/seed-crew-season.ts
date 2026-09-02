/**
 * Guaranteed Crew Season / leaderboard scenario for the main dev seed.
 *
 * Recreates the friendly-competition pilot shape so the Season + leaderboard can
 * be tested without hand-building data:
 *   - an Event with ELO + balanced teams enabled (Season prerequisites),
 *   - 12 account-linked participants with ratings,
 *   - 8 eligible past GameHistory games (played, non-friendly, snapshotted),
 *   - an open-registration Season starting before those games so the
 *     leaderboard defaults to it,
 *   - two crews pre-assigned so the Crew league renders on first load, plus six
 *     free agents to group live in the UI.
 *
 * All names, emails, and locations are randomly generated with faker — no real
 * personal data. season-v1 scoring: each member scores 3/1/0 from their own
 * side, a Crew's per-game score is the mean of its participating members, and
 * the best six of eight games count (docs/friendly-competition-pilot.md).
 *
 * Called from prisma/seed.ts; not a standalone script.
 */
import type { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";

const DAY = 86_400_000;
const PARTICIPANT_COUNT = 12;
const GAME_COUNT = 8;

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
}

/** Deterministic rotating 5-a-side lineups: ~10 of 12 play each game. */
function lineupsFor(gameIndex: number, names: string[]): [string[], string[]] {
  const shift = gameIndex % names.length;
  const rotated = [...names.slice(shift), ...names.slice(0, shift)];
  const playing = rotated.slice(0, 10);
  const teamOne: string[] = [];
  const teamTwo: string[] = [];
  playing.forEach((name, i) => (i % 2 === 0 ? teamOne : teamTwo).push(name));
  return [teamOne, teamTwo];
}

export async function seedCrewSeason(
  prisma: PrismaClient,
  demoUser: { id: string; email: string },
  now: number,
): Promise<void> {
  // Random but plausible participants with a descending rating spread so Crew
  // recommendation has something to balance. Unique names keep leaderboard
  // rows distinct (the standings key on name).
  const usedNames = new Set<string>();
  const participants = Array.from({ length: PARTICIPANT_COUNT }, (_, i) => {
    let name = faker.person.firstName();
    while (usedNames.has(name)) name = `${faker.person.firstName()} ${faker.string.alpha({ length: 1, casing: "upper" })}.`;
    usedNames.add(name);
    return { name, rating: 1320 - i * 30 + faker.number.int({ min: -15, max: 15 }) };
  });

  const city = faker.location.city();
  const event = await prisma.event.create({
    data: {
      title: `${faker.company.name()} (Crew Season demo)`,
      location: `${faker.location.street()}, ${city}`,
      latitude: faker.location.latitude(),
      longitude: faker.location.longitude(),
      dateTime: new Date(now + 3 * DAY),
      maxPlayers: 10,
      durationMinutes: 60,
      sport: "football-5v5",
      isPublic: true,
      teamOneName: "Team A",
      teamTwoName: "Team B",
      ownerId: demoUser.id,
      eloEnabled: true,
      balanced: true,
      showCompetitiveData: true,
    },
  });

  const eventPlayerByName = new Map<string, string>();
  const userByName = new Map<string, string>();
  for (const p of participants) {
    const email = faker.internet.email({ firstName: slugify(p.name) || "player", provider: "demo.convocados.test" }).toLowerCase();
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        id: `demo-crew-${faker.string.uuid()}`,
        name: p.name,
        email,
        emailVerified: true,
      },
    });
    userByName.set(p.name, user.id);
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: p.name, userId: user.id, rating: p.rating },
    });
    eventPlayerByName.set(p.name, ep.id);
    await prisma.playerRating.create({
      data: { eventId: event.id, name: p.name, userId: user.id, rating: p.rating },
    });
  }

  const names = participants.map((p) => p.name);
  const seasonStart = new Date(now - 9 * 7 * DAY);
  for (let i = 0; i < GAME_COUNT; i++) {
    const [teamOne, teamTwo] = lineupsFor(i, names);
    const scoreOne = faker.number.int({ min: 0, max: 5 });
    const scoreTwo = faker.number.int({ min: 0, max: 5 });
    const teamsSnapshot = JSON.stringify([
      { team: "Team A", players: teamOne.map((name, order) => ({ name, order })) },
      { team: "Team B", players: teamTwo.map((name, order) => ({ name, order })) },
    ]);
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(now - (GAME_COUNT - i) * 7 * DAY),
        status: "played",
        isFriendly: false,
        scoreOne,
        scoreTwo,
        teamOneName: "Team A",
        teamTwoName: "Team B",
        teamsSnapshot,
        source: "historical",
        eloProcessed: true,
      },
    });
  }

  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: `${faker.word.adjective()} ${faker.date.month()} Season`,
      status: "registration",
      registrationOpensAt: new Date(now - DAY),
      registrationClosesAt: new Date(now + 14 * DAY),
      startsAt: seasonStart,
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
        joinedAt: seasonStart,
      },
    });
    membershipByName.set(p.name, membership.id);
  }

  // Pre-assign two crews (first six participants) so the Crew league renders on
  // first load; the remaining six stay as free agents to group live in the UI.
  const crewOne = await prisma.crew.create({ data: { seasonId: season.id, name: faker.color.human(), sortOrder: 0 } });
  const crewTwo = await prisma.crew.create({ data: { seasonId: season.id, name: faker.color.human(), sortOrder: 1 } });
  const crewOneNames = names.slice(0, 3);
  const crewTwoNames = names.slice(3, 6);
  for (const name of crewOneNames) {
    await prisma.seasonMembership.update({ where: { id: membershipByName.get(name)! }, data: { crewId: crewOne.id } });
  }
  for (const name of crewTwoNames) {
    await prisma.seasonMembership.update({ where: { id: membershipByName.get(name)! }, data: { crewId: crewTwo.id } });
  }

  console.log(`\n  ** CREW SEASON EVENT (leaderboard + crews demo):`);
  console.log(`     ${event.id}  "${event.title}"`);
  console.log(`     ${GAME_COUNT} past games · ${crewOne.name} (${crewOneNames.join(", ")}) + ${crewTwo.name} (${crewTwoNames.join(", ")}) · 6 free agents`);
  console.log(`     Leaderboard:  /events/${event.id}/history`);
  console.log(`     Season setup: /events/${event.id}/seasons/${season.id}`);
  console.log(`     Sign in: ${demoUser.email} / demo123`);
}
