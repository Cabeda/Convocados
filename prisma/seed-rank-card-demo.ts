/**
 * Post-game Rank card demo seed — the state the new merged card is built for:
 * a Game that has ENDED but has NO score yet, inside an active Season with
 * Crews, so the card shows the viewer's current Rank Standing, the Crew
 * placement, the season link and the "score this to update it" cue.
 *
 *   npm run db:seed:rank-card
 *
 * Sign in as demo@convocados.app / demo123 and open the printed event URL.
 * Idempotent: re-running wipes and recreates the demo.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function localBase(): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  try {
    const p = readFileSync(".dev-port", "utf8").trim();
    if (p) return `http://localhost:${p}`;
  } catch { /* fall through */ }
  return "http://localhost:4321";
}

const DEMO_PASSWORD_HASH = "e85e17b8ccf0231ecc33406b98bf41b3:ac313125f11ad360382987c4c993c93d0346878a4ae3959669711822323fb8c5ac57f53975466b90b60f38ab5e81c263bbabcd821cab003641e4342f92e9dc45";
const DEMO_EMAIL = "demo@convocados.app";
const DEMO_ID = "demo-organizer-001";
const DEMO_NAME = "Demo Organizer";
const EVENT_TITLE = "Rank Card Demo";
const TZ = "Europe/Lisbon";

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}
function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 86_400_000);
}
function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 86_400_000);
}

interface P { name: string; rating: number; games: number }

// Demo user leads team one; three of them share a Crew, three share another.
const TEAM_ONE: P[] = [
  { name: DEMO_NAME, rating: 1050, games: 15 },
  { name: "Rita", rating: 1010, games: 9 },
  { name: "Tomás", rating: 990, games: 8 },
  { name: "Vera", rating: 980, games: 7 },
  { name: "Xavier", rating: 970, games: 6 },
];
const TEAM_TWO: P[] = [
  { name: "Nuno", rating: 1130, games: 14 },
  { name: "Sofia", rating: 1100, games: 13 },
  { name: "Pedro", rating: 1080, games: 12 },
  { name: "Marta", rating: 1060, games: 11 },
  { name: "Rui", rating: 1050, games: 10 },
];

async function main() {
  const demo = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { name: DEMO_NAME },
    create: { id: DEMO_ID, name: DEMO_NAME, email: DEMO_EMAIL, emailVerified: true },
  });
  const hasCredential = await prisma.account.findFirst({ where: { userId: demo.id, providerId: "credential" } });
  if (!hasCredential) {
    await prisma.account.create({
      data: { id: `account-${demo.id}`, accountId: demo.id, providerId: "credential", issuer: "local:credential", userId: demo.id, password: DEMO_PASSWORD_HASH },
    });
  }

  const existing = await prisma.event.findFirst({ where: { title: EVENT_TITLE, ownerId: demo.id } });
  if (existing) await prisma.event.delete({ where: { id: existing.id } });

  // Ended 1h ago (started 2h ago, 60 min long) — no score entered yet.
  const event = await prisma.event.create({
    data: {
      title: EVENT_TITLE,
      location: "Demo Court",
      timezone: TZ,
      dateTime: hoursAgo(2),
      durationMinutes: 60,
      maxPlayers: 10,
      isPublic: true,
      ownerId: demo.id,
      teamOneName: "Demo Team",
      teamTwoName: "Rivals",
      sport: "football",
      eloEnabled: true,
      rankEnabled: true,
      balanced: true,
      showCompetitiveData: true,
      mvpEnabled: false,
      splitCostsEnabled: false,
    },
  });

  const players = [...TEAM_ONE, ...TEAM_TWO];
  for (const p of players) {
    const isDemo = p.name === DEMO_NAME;
    const slug = p.name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    const user = await prisma.user.upsert({
      where: { email: `${slug}@rankcard.test` },
      update: {},
      create: { id: `rank-card-${slug}`, email: `${slug}@rankcard.test`, name: p.name, role: "user" },
    });
    await prisma.eventPlayer.create({
      data: { eventId: event.id, name: p.name, userId: isDemo ? demo.id : user.id, rating: p.rating, gamesPlayed: p.games },
    });
    await prisma.playerRating.create({ data: { eventId: event.id, name: p.name, rating: p.rating, gamesPlayed: p.games } });
  }

  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: "Rank Card Season",
      status: "active",
      registrationOpensAt: daysAgo(30),
      registrationClosesAt: daysFromNow(10),
      activatedAt: daysAgo(30),
      createdByUserId: demo.id,
    },
  });

  const eventPlayers = await prisma.eventPlayer.findMany({ where: { eventId: event.id } });

  // The current Game row — the one that just ended. It has no score yet, which
  // is the state the new card is built for.
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: hoursAgo(2), status: "played", teamOneName: "Demo Team", teamTwoName: "Rivals" },
  });
  for (const ep of eventPlayers) {
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ep.id } });
  }
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

  const membershipByName = new Map<string, string>();
  for (const ep of eventPlayers) {
    const membership = await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: ep.id, userId: ep.userId!, status: "active", joinedAt: daysAgo(30) },
    });
    membershipByName.set(ep.name, membership.id);
  }

  // Two Crews so the crew line has a place to report. First three of each
  // team form a Crew; the rest stay free agents.
  const crewOne = await prisma.crew.create({ data: { seasonId: season.id, name: "Vermelhos", sortOrder: 0 } });
  const crewTwo = await prisma.crew.create({ data: { seasonId: season.id, name: "Azuis", sortOrder: 1 } });
  for (const name of ["Demo Organizer", "Rita", "Tomás"]) {
    await prisma.seasonMembership.update({ where: { id: membershipByName.get(name)! }, data: { crewId: crewOne.id } });
  }
  for (const name of ["Nuno", "Sofia", "Pedro"]) {
    await prisma.seasonMembership.update({ where: { id: membershipByName.get(name)! }, data: { crewId: crewTwo.id } });
  }

  const teamsSnapshot = JSON.stringify([
    { team: "Demo Team", players: TEAM_ONE.map((p, o) => ({ name: p.name, order: o })) },
    { team: "Rivals", players: TEAM_TWO.map((p, o) => ({ name: p.name, order: o })) },
  ]);

  // Three counted Games so the viewer is out of the provisional window, then
  // the Game that just ended — deliberately left without a score.
  const scored = [
    { dateTime: daysAgo(21), scoreOne: 3, scoreTwo: 1 },
    { dateTime: daysAgo(14), scoreOne: 2, scoreTwo: 2 },
    { dateTime: daysAgo(7), scoreOne: 4, scoreTwo: 2 },
  ];
  for (const g of scored) {
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: g.dateTime,
        status: "played",
        isFriendly: false,
        scoreOne: g.scoreOne,
        scoreTwo: g.scoreTwo,
        teamOneName: "Demo Team",
        teamTwoName: "Rivals",
        teamsSnapshot,
      },
    });
  }
  await prisma.gameHistory.create({
    data: {
      eventId: event.id,
      dateTime: hoursAgo(2),
      status: "played",
      isFriendly: false,
      scoreOne: null,
      scoreTwo: null,
      teamOneName: "Demo Team",
      teamTwoName: "Rivals",
      teamsSnapshot,
    },
  });

  const base = localBase();
  console.log("\n✓ Rank card demo seeded");
  console.log(`  Event:   ${base}/events/${event.id}`);
  console.log(`  Season:  ${base}/events/${event.id}/seasons/${season.id}`);
  console.log(`  Sign in: ${DEMO_EMAIL} / demo123`);
  console.log("  Game ended 1h ago with NO score — open it to see the standing + cue.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
