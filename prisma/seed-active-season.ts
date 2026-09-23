/**
 * Guaranteed active-Season scenario for the admin Season demo.
 *
 * Recreates the shape of a full event: a live football-5v5 game with a full
 * roster, two teams, past results and ratings, plus ONE Season in the `active`
 * lifecycle state.
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

/**
 * Seed a goal timeline that agrees with the stored scoreline (ADR 0039), so the
 * history page's derived score matches the seeded result.
 *
 * `rich` games give the demo a deeper timeline to look at: every goal gets a
 * minute, more of them carry an assist, and one is a penalty. The demo user is
 * guaranteed at least one goal in the latest game so the picker's default name
 * is visibly meaningful.
 */
async function seedActiveSeasonGoals(
  prisma: PrismaClient,
  gameHistoryId: string,
  scoreOne: number,
  scoreTwo: number,
  teamOne: string[],
  teamTwo: string[],
  eventPlayerByName: Map<string, string>,
  rich: boolean,
): Promise<void> {
  const sides: Array<"one" | "two"> = [];
  const [more, fewer]: ["one" | "two", "one" | "two"] = scoreOne >= scoreTwo ? ["one", "two"] : ["two", "one"];
  for (let i = 0; i < Math.min(scoreOne, scoreTwo); i++) sides.push(more, fewer);
  for (let i = 0; i < Math.abs(scoreOne - scoreTwo); i++) sides.push(more);
  if (sides.length === 0) return;

  let minute = faker.number.int({ min: 3, max: 12 });
  for (const team of sides) {
    const pool = (team === "one" ? teamOne : teamTwo).filter((n) => eventPlayerByName.has(n));
    const scorerName = pool.length ? faker.helpers.arrayElement(pool) : null;
    if (!scorerName) continue;

    const assistPool = (team === "one" ? teamOne : teamTwo).filter((n) => n !== scorerName && eventPlayerByName.has(n));
    const wantsAssist = rich ? Math.random() < 0.7 : Math.random() < 0.45;
    const assistName = wantsAssist && assistPool.length ? faker.helpers.arrayElement(assistPool) : null;

    await prisma.matchEvent.create({
      data: {
        gameHistoryId,
        type: "goal",
        team,
        minute,
        ownGoal: false,
        penalty: rich && Math.random() < 0.15,
        scorerEventPlayerId: eventPlayerByName.get(scorerName) ?? null,
        scorerName,
        assistEventPlayerId: assistName ? (eventPlayerByName.get(assistName) ?? null) : null,
        assistName,
      },
    });
    minute += faker.number.int({ min: 4, max: 14 });
  }
}

export async function seedActiveSeason(
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

  // Faker-generated club identity + venue so no real event/location leaks in.
  const clubName = faker.company.name();
  const venueName = `${faker.location.streetAddress()}, ${faker.location.city()}`;
  const teamOneName = "Reds";
  const teamTwoName = "Blues";

  // The signed-in demo user plays too, so they can be picked as a scorer and
  // their own stats/editing affordances are populated. Named "Demo Organizer"
  // to match the account.
  const demoPlayerName = "Demo Organizer";

  // Live now: kicked off 20 minutes ago in a 60-minute game.
  const event = await prisma.event.create({
    data: {
      title: clubName,
      location: venueName,
      latitude: faker.location.latitude(),
      longitude: faker.location.longitude(),
      dateTime: new Date(now - 20 * 60 * 1000),
      maxPlayers: PARTICIPANT_COUNT,
      durationMinutes: 60,
      sport: "football-5v5",
      isPublic: true,
      teamOneName,
      teamTwoName,
      ownerId: demoUser.id,
      eloEnabled: true,
      balanced: true,
      showCompetitiveData: true,
    },
  });

  const eventPlayerByName = new Map<string, string>();
  const userByName = new Map<string, string>();

  // Register the demo user on the roster first, so they are order 0 and appear
  // in the scorer picker for every game.
  await prisma.player.create({ data: { eventId: event.id, name: demoPlayerName, order: 0, userId: demoUser.id } });
  const demoEventPlayer = await prisma.eventPlayer.create({
    data: { eventId: event.id, name: demoPlayerName, userId: demoUser.id, rating: 1400 },
  });
  eventPlayerByName.set(demoPlayerName, demoEventPlayer.id);
  userByName.set(demoPlayerName, demoUser.id);
  await prisma.playerRating.create({
    data: { eventId: event.id, name: demoPlayerName, userId: demoUser.id, rating: 1400, gamesPlayed: GAME_COUNT },
  });

  for (const [order, p] of participants.entries()) {
    const email = faker.internet.email({ firstName: slugify(p.name) || "player", provider: "demo.convocados.test" }).toLowerCase();
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { id: `demo-active-season-${faker.string.uuid()}`, name: p.name, email, emailVerified: true },
    });
    userByName.set(p.name, user.id);
    // Legacy roster (drives the event page player list).
    await prisma.player.create({ data: { eventId: event.id, name: p.name, order: order + 1, userId: user.id } });
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

  // Everyone eligible to play, demo user included, so the latest game's lineup
  // contains the account we sign in with.
  const names = [demoPlayerName, ...participants.map((p) => p.name)];
  for (let i = 0; i < GAME_COUNT; i++) {
    const [teamOne, teamTwo] = lineupsFor(i, names);
    const scoreOne = faker.number.int({ min: 0, max: 6 });
    const scoreTwo = faker.number.int({ min: 0, max: 6 });
    const teamsSnapshot = JSON.stringify([
      { team: teamOneName, players: teamOne.map((name, order) => ({ name, order })) },
      { team: teamTwoName, players: teamTwo.map((name, order) => ({ name, order })) },
    ]);
    const history = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(now - (GAME_COUNT - i) * 7 * DAY),
        status: "played",
        isFriendly: false,
        scoreOne,
        scoreTwo,
        teamOneName,
        teamTwoName,
        teamsSnapshot,
        source: "historical",
        eloProcessed: true,
      },
    });

    // Goal timeline that agrees with the stored score, so the derived score and
    // the seeded scoreline match. The most recent game gets the richest set.
    await seedActiveSeasonGoals(prisma, history.id, scoreOne, scoreTwo, teamOne, teamTwo, eventPlayerByName, i === GAME_COUNT - 1);
  }

  // Current teams so the live event page renders both sides.
  const half = Math.floor(names.length / 2);
  const teamOneNames = names.slice(0, half);
  const teamTwoNames = names.slice(half);
  await prisma.teamResult.create({
    data: { name: teamOneName, eventId: event.id, members: { create: teamOneNames.map((name, order) => ({ name, order })) } },
  });
  await prisma.teamResult.create({
    data: { name: teamTwoName, eventId: event.id, members: { create: teamTwoNames.map((name, order) => ({ name, order })) } },
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
  for (const name of names) {
    const membership = await prisma.seasonMembership.create({
      data: {
        seasonId: season.id,
        eventPlayerId: eventPlayerByName.get(name)!,
        userId: userByName.get(name)!,
        status: "active",
        joinedAt: new Date(now - 60 * DAY),
      },
    });
    membershipByName.set(name, membership.id);
  }

  const crewOne = await prisma.crew.create({ data: { seasonId: season.id, name: teamOneName, sortOrder: 0 } });
  const crewTwo = await prisma.crew.create({ data: { seasonId: season.id, name: teamTwoName, sortOrder: 1 } });
  for (const name of teamOneNames) {
    await prisma.seasonMembership.update({ where: { id: membershipByName.get(name)! }, data: { crewId: crewOne.id } });
  }
  for (const name of teamTwoNames) {
    await prisma.seasonMembership.update({ where: { id: membershipByName.get(name)! }, data: { crewId: crewTwo.id } });
  }

  console.log(`\n  ** ACTIVE SEASON DEMO (active Season / no complete action):`);
  console.log(`     ${event.id}  "${event.title}"  ${PARTICIPANT_COUNT}/${PARTICIPANT_COUNT} players  (live)`);
  console.log(`     ${GAME_COUNT} past games · crews: ${teamOneName} (${teamOneNames.join(", ")}) / ${teamTwoName} (${teamTwoNames.join(", ")})`);
  console.log(`     Demo user "${demoPlayerName}" is on the roster and the latest game's lineup — sign in to edit goals`);
  console.log(`     Season: "${season.name}"  status=active  window ${new Date(now - 365 * DAY).toISOString().slice(0, 10)} → ${new Date(now + 730 * DAY).toISOString().slice(0, 10)}`);
  console.log(`     Event:   /events/${event.id}`);
  console.log(`     Seasons: /events/${event.id}/seasons`);
  console.log(`     Repro:   Start new Season with any dates → 409 overlap`);
  console.log(`     Sign in: ${demoUser.email} / demo123`);
}
