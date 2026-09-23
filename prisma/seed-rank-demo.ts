/**
 * Season Rank demo seed — one public event with an active Season, Crews, and a
 * played-game history so the Season Rank ladder is populated for manual testing.
 *
 *   npm run db:seed:rank
 *
 * Sign in as demo-rank-organizer@convocados.app / demo123 (owner) to test the
 * Competition settings and admin views; the event is public so the Season page
 * and Rank table are viewable without an account.
 *
 * Idempotent: re-running wipes the previous "Rank Demo" event and recreates it.
 */
import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();

const TZ = "Europe/Lisbon";
const EVENT_TITLE = "Rank Demo";
const OWNER_EMAIL = "demo-rank-organizer@convocados.app";

interface P { name: string; rating: number; games: number; crew: number; }

/** Unique faker-generated first names — no real personal data. */
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

// Ratings spread so tiers populate; a couple of provisional (<3 game) players.
// Ratings/crew/games are fixed for deterministic output; names are random.
const PLAYER_NAMES = uniqueFirstNames(12);
const PLAYER_SPECS: Omit<P, "name">[] = [
  { rating: 1150, games: 15, crew: 0 },
  { rating: 1110, games: 14, crew: 0 },
  { rating: 1060, games: 12, crew: 0 },
  { rating: 1020, games: 11, crew: 0 },
  { rating: 990, games: 10, crew: 1 },
  { rating: 960, games: 9, crew: 1 },
  { rating: 930, games: 8, crew: 1 },
  { rating: 900, games: 7, crew: 1 },
  { rating: 1010, games: 6, crew: 2 },
  { rating: 985, games: 4, crew: 2 },
  { rating: 1000, games: 1, crew: 2 },
  { rating: 1000, games: 0, crew: 2 },
];
const PLAYERS: P[] = PLAYER_SPECS.map((spec, i) => ({ name: PLAYER_NAMES[i]!, ...spec }));

const CREWS = ["Brothers", "Rockets", "Titans"];
const WEEKS = 8;

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(20, 0, 0, 0);
  return d;
}

async function main() {
  // 1. Owner: reuse an existing event's owner so a signed-in user owns the demo;
  //    fall back to a placeholder user.
  const anyEvent = await prisma.event.findFirst({ select: { ownerId: true } });
  const ownerId = anyEvent?.ownerId ?? "rank-demo-owner";
  if (!anyEvent?.ownerId) {
    await prisma.user.upsert({
      where: { id: ownerId },
      update: {},
      create: { id: ownerId, name: "Rank Demo Organizer", email: OWNER_EMAIL },
    });
  }

  // 2. Wipe a previous demo event (cascades games/season/memberships/etc.)
  const existing = await prisma.event.findFirst({ where: { title: EVENT_TITLE, ownerId } });
  if (existing) {
    await prisma.event.delete({ where: { id: existing.id } });
  }

  // 3. Event
  const opensAt = daysAgo(WEEKS * 7 + 2);
  const closesAt = daysAgo(-2);
  const event = await prisma.event.create({
    data: {
      title: EVENT_TITLE,
      location: "Demo Court",
      timezone: TZ,
      dateTime: daysAgo(-3),
      maxPlayers: 10,
      isPublic: true,
      ownerId,
      sport: "football",
      eloEnabled: true,
      rankEnabled: true,
      balanced: true,
      showCompetitiveData: true,
      mvpEnabled: true,
      splitCostsEnabled: false,
    },
  });

  // 4. Players: EventPlayer + linked User + PlayerRating (the live Elo store)
  for (const p of PLAYERS) {
    const slug = p.name.toLowerCase().replace(/[^a-z]/g, "");
    const user = await prisma.user.upsert({
      where: { email: `${slug}@rankdemo.test` },
      update: {},
      create: { id: `rank-demo-${slug}`, email: `${slug}@rankdemo.test`, name: p.name, role: "user" },
    });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: p.name, userId: user.id } });
    await prisma.playerRating.create({ data: { eventId: event.id, name: p.name, rating: p.rating, gamesPlayed: p.games } });
  }

  // 5. Season (active) covering the game window
  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: "Rank Demo Season",
      status: "active",
      registrationOpensAt: opensAt,
      registrationClosesAt: closesAt,
      activatedAt: new Date(),
    },
  });

  // 6. Memberships + Crews
  const eventPlayers = await prisma.eventPlayer.findMany({ where: { eventId: event.id } });
  const byName = new Map(eventPlayers.map((ep) => [ep.name, ep]));
  const crewIds: string[] = [];
  for (let i = 0; i < CREWS.length; i++) {
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: CREWS[i], sortOrder: i } });
    crewIds.push(crew.id);
  }
  for (const p of PLAYERS) {
    const ep = byName.get(p.name)!;
    await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: ep.id, userId: ep.userId!, crewId: crewIds[p.crew], status: "active", joinedAt: opensAt },
    });
  }

  // 7. Games: 8 weeks, two teams of 5 rotated deterministically
  const names = PLAYERS.map((p) => p.name);
  for (let w = 0; w < WEEKS; w++) {
    // rotate the roster so different players meet
    const roster = [...names.slice(w % names.length), ...names.slice(0, w % names.length)].slice(0, 10);
    const t1 = roster.filter((_, i) => i % 2 === 0);
    const t2 = roster.filter((_, i) => i % 2 === 1);
    // stronger players tend to win: score from average rating
    const avg = (t: string[]) => t.reduce((s, n) => s + (PLAYERS.find((p) => p.name === n)!.rating), 0) / t.length;
    const s1 = avg(t1) >= avg(t2) ? 3 + (w % 2) : 1 + (w % 2);
    const s2 = avg(t1) >= avg(t2) ? 1 + (w % 2) : 3 + (w % 2);
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: daysAgo((WEEKS - w) * 7),
        status: "played",
        isFriendly: false,
        scoreOne: s1,
        scoreTwo: s2,
        teamOneName: "Team A",
        teamTwoName: "Team B",
        teamsSnapshot: JSON.stringify([
          { team: "Team A", players: t1.map((n, o) => ({ name: n, order: o })) },
          { team: "Team B", players: t2.map((n, o) => ({ name: n, order: o })) },
        ]),
      },
    });
  }

  const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:4321";
  console.log("\n✓ Rank demo seeded");
  console.log(`  Event:  ${base}/events/${event.id}`);
  console.log(`  Season: ${base}/events/${event.id}/seasons/${season.id}`);
  console.log(`  Settings: ${base}/events/${event.id}/settings`);
  console.log("  The event is public — view it without signing in; sign in as the owner to test settings.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
