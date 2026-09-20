/**
 * Rank reveal demo seed — fabricates a game that just ended, with the demo
 * user ("Demo Organizer") on the WINNING team, inside an active Season, so the
 * post-game Season Rank reveal (and its "Why?" explainer link) can be seen
 * locally.
 *
 *   npm run db:seed:rank-reveal
 *
 * Then sign in as demo@convocados.app / demo123 and open the printed event URL.
 * The game ended ~2h ago, the demo user played and won, so the wrap-up banner
 * shows the Rank movement. Idempotent: re-running wipes and recreates the demo.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** The dev server's actual port, so printed URLs aren't wrong (scripts/dev.sh writes .dev-port). */
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
const EVENT_TITLE = "Rank Reveal Demo";
const TZ = "Europe/Lisbon";

/** Hours from now (negative = past). */
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}
function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 86_400_000);
}

interface P { name: string; rating: number; games: number; }

// The demo user is the strongest on their (winning) team, but the team average
// is the underdog, so the win pays a healthy positive delta rather than the
// clamp floor.
const WINNERS: P[] = [
  { name: DEMO_NAME, rating: 1050, games: 15 },
  { name: "Rita", rating: 1010, games: 9 },
  { name: "Tomás", rating: 990, games: 8 },
  { name: "Vera", rating: 980, games: 7 },
  { name: "Xavier", rating: 970, games: 6 },
];
const LOSERS: P[] = [
  { name: "Nuno", rating: 1130, games: 14 },
  { name: "Sofia", rating: 1100, games: 13 },
  { name: "Pedro", rating: 1080, games: 12 },
  { name: "Marta", rating: 1060, games: 11 },
  { name: "Rui", rating: 1050, games: 10 },
];

async function main() {
  // 1. Demo user (reused by prisma/seed.ts) — ensure it can sign in.
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

  // 2. Wipe a previous copy of this demo event.
  const existing = await prisma.event.findFirst({ where: { title: EVENT_TITLE, ownerId: demo.id } });
  if (existing) await prisma.event.delete({ where: { id: existing.id } });

  // 3. Event that just ended (started 2h ago, 60 min long → ended 1h ago).
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
      sport: "football",
      eloEnabled: true,
      rankEnabled: true,
      balanced: true,
      showCompetitiveData: true,
      // MVP open (no votes yet) keeps the wrap-up banner mounted for the reveal.
      mvpEnabled: true,
      splitCostsEnabled: false,
    },
  });

  // 4. Players: EventPlayer + linked User + PlayerRating.
  const players = [...WINNERS, ...LOSERS];
  for (const p of players) {
    const isDemo = p.name === DEMO_NAME;
    const slug = p.name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    const user = await prisma.user.upsert({
      where: { email: `${slug}@rankreveal.test` },
      update: {},
      create: { id: `rank-reveal-${slug}`, email: `${slug}@rankreveal.test`, name: p.name, role: "user" },
    });
    await prisma.eventPlayer.create({
      data: { eventId: event.id, name: p.name, userId: isDemo ? demo.id : user.id, rating: p.rating, gamesPlayed: p.games },
    });
    await prisma.playerRating.create({ data: { eventId: event.id, name: p.name, rating: p.rating, gamesPlayed: p.games } });
  }

  // 5. Active Season covering the game.
  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: "Rank Reveal Season",
      status: "active",
      registrationOpensAt: daysFromNow(-30),
      registrationClosesAt: daysFromNow(10),
      activatedAt: daysFromNow(-30),
      createdByUserId: demo.id,
    },
  });

  // 6. All players are active Season members (the viewer must be a member).
  const eventPlayers = await prisma.eventPlayer.findMany({ where: { eventId: event.id } });
  for (const ep of eventPlayers) {
    await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: ep.id, userId: ep.userId!, status: "active", joinedAt: daysFromNow(-30) },
    });
  }

  // 7. Two earlier counted games + the one that just ended. Three counted games
  //    moves the demo user out of the provisional window, so the Rank reveal
  //    shows the count-up rather than the unlock counter.
  const teamsSnapshot = JSON.stringify([
    { team: "Demo Team", players: WINNERS.map((p, o) => ({ name: p.name, order: o })) },
    { team: "Rivals", players: LOSERS.map((p, o) => ({ name: p.name, order: o })) },
  ]);
  const games = [
    { dateTime: hoursAgo(2), scoreOne: 3, scoreTwo: 1 },   // just ended — demo wins
    { dateTime: daysFromNow(-9), scoreOne: 2, scoreTwo: 1 }, // demo wins
    { dateTime: daysFromNow(-16), scoreOne: 1, scoreTwo: 2 }, // demo loses
  ];
  for (const g of games) {
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

  const base = localBase();
  console.log("\n✓ Rank reveal demo seeded");
  console.log(`  Event:   ${base}/events/${event.id}`);
  console.log(`  Season:  ${base}/events/${event.id}/seasons/${season.id}`);
  console.log(`  Sign in: ${DEMO_EMAIL} / demo123`);
  console.log("  Open the event signed in as the demo user to see the wrap-up reveal.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
