/**
 * Guaranteed Crew Season / leaderboard scenario for the main dev seed.
 *
 * Recreates the Ninjas da Areosa pilot shape so the Season + leaderboard can be
 * tested without hand-building data:
 *   - an Event with ELO + balanced teams enabled (Season prerequisites),
 *   - 12 account-linked participants with ratings,
 *   - 8 eligible past GameHistory games (played, non-friendly, snapshotted),
 *   - an open-registration Season starting before those games so the
 *     leaderboard defaults to it,
 *   - two crews pre-assigned (Red, Blue) so the Crew league renders on first
 *     load, plus six free agents to group live in the UI.
 *
 * season-v1 scoring (see docs/friendly-competition-pilot.md): each member
 * scores 3/1/0 from their own side, a Crew's per-game score is the mean of its
 * participating members, and the best six of eight games count.
 *
 * Called from prisma/seed.ts; not a standalone script.
 */
import type { PrismaClient } from "@prisma/client";

const DAY = 86_400_000;

const PARTICIPANTS: Array<{ name: string; rating: number }> = [
  { name: "André", rating: 1320 },
  { name: "Bruno", rating: 1280 },
  { name: "Carlos", rating: 1240 },
  { name: "Diogo", rating: 1210 },
  { name: "Eduardo", rating: 1180 },
  { name: "Fábio", rating: 1150 },
  { name: "Gonçalo", rating: 1120 },
  { name: "Hugo", rating: 1090 },
  { name: "Igor", rating: 1060 },
  { name: "João", rating: 1030 },
  { name: "Luís", rating: 1000 },
  { name: "Miguel", rating: 970 },
];

// Eight scorelines (teamOne–teamTwo): a mix of wins and draws.
const SCORES: Array<[number, number]> = [
  [3, 1], [2, 2], [1, 0], [4, 2], [0, 1], [2, 3], [3, 3], [5, 2],
];

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
  const event = await prisma.event.create({
    data: {
      title: "Ninjas da Areosa (Crew Season demo)",
      location: "Areosa, Porto",
      latitude: 41.1710,
      longitude: -8.6290,
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
  for (const p of PARTICIPANTS) {
    const slug = p.name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    const user = await prisma.user.upsert({
      where: { email: `${slug}.ninjas@demo.convocados.app` },
      update: {},
      create: {
        id: `demo-ninja-${slug}`,
        name: p.name,
        email: `${slug}.ninjas@demo.convocados.app`,
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

  const names = PARTICIPANTS.map((p) => p.name);
  const seasonStart = new Date(now - 9 * 7 * DAY);
  for (let i = 0; i < 8; i++) {
    const [teamOne, teamTwo] = lineupsFor(i, names);
    const [scoreOne, scoreTwo] = SCORES[i];
    const teamsSnapshot = JSON.stringify([
      { team: "Team A", players: teamOne.map((name, order) => ({ name, order })) },
      { team: "Team B", players: teamTwo.map((name, order) => ({ name, order })) },
    ]);
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(now - (8 - i) * 7 * DAY),
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
      name: "Ninjas Pilot Season",
      status: "registration",
      registrationOpensAt: new Date(now - DAY),
      registrationClosesAt: new Date(now + 14 * DAY),
      startsAt: seasonStart,
      createdByUserId: demoUser.id,
    },
  });

  const membershipByName = new Map<string, string>();
  for (const p of PARTICIPANTS) {
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

  const red = await prisma.crew.create({ data: { seasonId: season.id, name: "Red", sortOrder: 0 } });
  const blue = await prisma.crew.create({ data: { seasonId: season.id, name: "Blue", sortOrder: 1 } });
  for (const name of ["André", "Carlos", "Eduardo"]) {
    await prisma.seasonMembership.update({ where: { id: membershipByName.get(name)! }, data: { crewId: red.id } });
  }
  for (const name of ["Bruno", "Diogo", "Fábio"]) {
    await prisma.seasonMembership.update({ where: { id: membershipByName.get(name)! }, data: { crewId: blue.id } });
  }

  console.log(`\n  ** CREW SEASON EVENT (leaderboard + crews demo):`);
  console.log(`     ${event.id}  "${event.title}"`);
  console.log(`     8 past games · Red (André, Carlos, Eduardo) + Blue (Bruno, Diogo, Fábio) · 6 free agents`);
  console.log(`     Leaderboard:  /events/${event.id}/history`);
  console.log(`     Season setup: /events/${event.id}/seasons/${season.id}`);
  console.log(`     Sign in: ${demoUser.email} / demo123`);
}
