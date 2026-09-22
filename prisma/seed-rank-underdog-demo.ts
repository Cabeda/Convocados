/**
 * Underdog-win Rank reveal demo.
 *
 * Builds a synthetic scenario where the demo user is the lowest-rated player on
 * a team that wins against a stronger side, so the post-game reveal shows a
 * healthy positive Rank Points delta (E≈0.424 → ~+184 RP with the clamped
 * payout) instead of the clamp floor.
 *
 *   npm run db:seed:rank-underdog
 *
 * All player names, club, and location are faker-generated — no real personal
 * data. Idempotent: re-running wipes and recreates the demo event.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";

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
const EVENT_TITLE = "Underdog Rank Demo";
const TZ = "Europe/Lisbon";

function hoursAgo(h: number): Date { return new Date(Date.now() - h * 3_600_000); }
function daysFromNow(d: number): Date { return new Date(Date.now() + d * 86_400_000); }

interface P { name: string; rating: number; games: number; }

/** Unique faker first names, so rosters never collide. */
function uniqueFirstNames(count: number): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  while (out.length < count) {
    let name = faker.person.firstName();
    while (used.has(name)) name = `${faker.person.firstName()} ${faker.string.alpha({ length: 1, casing: "upper" })}.`;
    used.add(name);
    out.push(name);
  }
  return out;
}

// Ratings are fixed so the Elo math is deterministic; only names are random.
// Underdogs (win 11-6) — the demo user is the lowest-rated player here.
const UNDERDOG_RATINGS = [1024, 1010, 934, 1024, 972];
const UNDERDOG_GAMES = [1, 5, 14, 3, 10];
// Favourites (lose 6-11) — stronger average on paper.
const FAVOURITE_RATINGS = [1053, 963, 902, 1015, 1000];
const FAVOURITE_GAMES = [18, 11, 14, 18, 3];

const underdogNames = uniqueFirstNames(UNDERDOG_RATINGS.length);
const favouriteNames = uniqueFirstNames(FAVOURITE_RATINGS.length);

const UNDERDOGS: P[] = UNDERDOG_RATINGS.map((rating, i) => ({
  name: i === 2 ? DEMO_NAME : underdogNames[i]!,
  rating,
  games: UNDERDOG_GAMES[i]!,
}));
const FAVOURITES: P[] = FAVOURITE_RATINGS.map((rating, i) => ({
  name: favouriteNames[i]!,
  rating,
  games: FAVOURITE_GAMES[i]!,
}));

const FAVOURITE_TEAM = "Blues";
const UNDERDOG_TEAM = "Reds";

function slug(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
}

async function main() {
  // 1. Demo user is the underdog for this scenario.
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

  const event = await prisma.event.create({
    data: {
      title: EVENT_TITLE,
      location: `${faker.location.streetAddress()}, ${faker.location.city()}`,
      timezone: TZ,
      dateTime: hoursAgo(2),
      durationMinutes: 60,
      maxPlayers: 10,
      isPublic: true,
      ownerId: demo.id,
      sport: "football-5v5",
      eloEnabled: true,
      rankEnabled: true,
      balanced: true,
      showCompetitiveData: true,
      mvpEnabled: true,
      splitCostsEnabled: false,
      createdAt: daysFromNow(-30),
    },
  });

  // 2. Players (EventPlayer + linked User + PlayerRating).
  const domain = "rankdemo.test";
  for (const p of [...FAVOURITES, ...UNDERDOGS]) {
    const isDemo = p.name === DEMO_NAME;
    const user = await prisma.user.upsert({
      where: { email: `${slug(p.name)}@${domain}` },
      update: {},
      create: { id: `rank-underdog-${slug(p.name)}`, email: `${slug(p.name)}@${domain}`, name: p.name, role: "user" },
    });
    await prisma.eventPlayer.create({
      data: { eventId: event.id, name: p.name, userId: isDemo ? demo.id : user.id, rating: p.rating, gamesPlayed: p.games },
    });
    await prisma.playerRating.create({ data: { eventId: event.id, name: p.name, rating: p.rating, gamesPlayed: p.games } });
  }

  // 3. Active season.
  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: "Q3 2026",
      status: "active",
      registrationOpensAt: new Date("2026-09-01T00:00:00.000Z"),
      registrationClosesAt: new Date("2026-12-31T00:00:00.000Z"),
      activatedAt: new Date("2026-09-01T00:00:00.000Z"),
      createdByUserId: demo.id,
    },
  });

  const eventPlayers = await prisma.eventPlayer.findMany({ where: { eventId: event.id } });
  for (const ep of eventPlayers) {
    await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: ep.id, userId: ep.userId!, status: "active", joinedAt: new Date("2026-09-01T00:00:00.000Z") },
    });
  }

  // 4. Three counted games (so the demo user is past provisional); the last is
  //    the underdog win, dated "just ended" so the wrap-up banner renders.
  const teamsSnapshot = JSON.stringify([
    { team: FAVOURITE_TEAM, players: FAVOURITES.map((p, o) => ({ name: p.name, order: o })) },
    { team: UNDERDOG_TEAM, players: UNDERDOGS.map((p, o) => ({ name: p.name, order: o })) },
  ]);
  const games = [
    { dateTime: hoursAgo(2), scoreOne: 6, scoreTwo: 11 },      // just ended — underdog wins 11-6
    { dateTime: daysFromNow(-6), scoreOne: 9, scoreTwo: 7 },    // underdog loses
    { dateTime: daysFromNow(-13), scoreOne: 8, scoreTwo: 10 },  // underdog wins
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
        teamOneName: FAVOURITE_TEAM,
        teamTwoName: UNDERDOG_TEAM,
        teamsSnapshot,
      },
    });
  }

  const base = localBase();
  console.log("\n✓ Underdog rank demo seeded");
  console.log(`  Event:   ${base}/events/${event.id}`);
  console.log(`  Sign in: ${DEMO_EMAIL} / demo123  (demo user is the lowest-rated underdog, 934)`);
  console.log("  Expected last-game delta: ~+184 RP (underdog win, E≈0.424)\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
