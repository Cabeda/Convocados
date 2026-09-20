/**
 * "Nuno Polónia" replica seed — recreates the real Ninjas da Areosa (Q3 2026)
 * scenario locally so we can see what a player in Nuno's position would win
 * under the Rank Points model.
 *
 *   npm run db:seed:ninjas-nuno
 *
 * Real data (prod, event cmmkfrx8b0000o2ixrix1yp2m, game 2026-09-14):
 *   Gunas (won 11-6) avg 993: Martinho 1024, David Ribeiro 1010,
 *       Nuno Polónia 934, Cabeda 1024, Luís Lopes 972
 *   Ninjas (lost 6-11) avg 987: João Fernandes 1053, Tiago Magalhães 963,
 *       Manuel Magalhães 902, TF 1015, Ruben Almeida 1000
 *   Nuno's team was the underdog: E≈0.424 -> +184 RP with the clamped payout.
 *
 * The demo user (demo@convocados.app / demo123) is renamed to "Nuno Polónia"
 * and given Nuno's Skill Rating (934), so the post-game reveal shows exactly
 * what he would win. Two earlier Q3 games are added so Nuno is past provisional.
 * Idempotent: re-running wipes and recreates the demo event.
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
const NUNO_NAME = "Nuno Polónia";
const EVENT_TITLE = "Ninjas da Areosa (Nuno demo)";
const TZ = "Europe/Lisbon";

function hoursAgo(h: number): Date { return new Date(Date.now() - h * 3_600_000); }
function daysFromNow(d: number): Date { return new Date(Date.now() + d * 86_400_000); }

interface P { name: string; rating: number; games: number; }

// Gunas — Nuno's team, the underdog that won 11-6.
const GUNAS: P[] = [
  { name: "Martinho", rating: 1024, games: 1 },
  { name: "David Ribeiro", rating: 1010, games: 5 },
  { name: NUNO_NAME, rating: 934, games: 14 },
  { name: "Cabeda", rating: 1024, games: 3 },
  { name: "Luís Lopes", rating: 972, games: 10 },
];
// Ninjas — the stronger-average side that lost 6-11.
const NINJAS: P[] = [
  { name: "João Fernandes", rating: 1053, games: 18 },
  { name: "Tiago Magalhães", rating: 963, games: 11 },
  { name: "Manuel Magalhães", rating: 902, games: 14 },
  { name: "TF", rating: 1015, games: 18 },
  { name: "Ruben Almeida", rating: 1000, games: 3 },
];

function slug(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
}

async function main() {
  // 1. Demo user becomes Nuno for this scenario.
  const demo = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { name: NUNO_NAME },
    create: { id: DEMO_ID, name: NUNO_NAME, email: DEMO_EMAIL, emailVerified: true },
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
      location: "Areosa",
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

  // 2. Players (EventPlayer + linked User + PlayerRating) with their real ratings.
  for (const p of [...NINJAS, ...GUNAS]) {
    const isNuno = p.name === NUNO_NAME;
    const user = await prisma.user.upsert({
      where: { email: `${slug(p.name)}@ninjas.test` },
      update: {},
      create: { id: `ninjas-${slug(p.name)}`, email: `${slug(p.name)}@ninjas.test`, name: p.name, role: "user" },
    });
    await prisma.eventPlayer.create({
      data: { eventId: event.id, name: p.name, userId: isNuno ? demo.id : user.id, rating: p.rating, gamesPlayed: p.games },
    });
    await prisma.playerRating.create({ data: { eventId: event.id, name: p.name, rating: p.rating, gamesPlayed: p.games } });
  }

  // 3. Q3 2026 season (active).
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

  // 4. Three counted Q3 games (so Nuno is past provisional); the last is the
  //    real 11-6 win, dated "just ended" so the wrap-up banner renders.
  const teamsSnapshot = JSON.stringify([
    { team: "Ninjas", players: NINJAS.map((p, o) => ({ name: p.name, order: o })) },
    { team: "Gunas", players: GUNAS.map((p, o) => ({ name: p.name, order: o })) },
  ]);
  const games = [
    { dateTime: hoursAgo(2), scoreOne: 6, scoreTwo: 11 },      // just ended — Nuno wins 11-6
    { dateTime: daysFromNow(-6), scoreOne: 9, scoreTwo: 7 },    // Nuno loses
    { dateTime: daysFromNow(-13), scoreOne: 8, scoreTwo: 10 },  // Nuno wins
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
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        teamsSnapshot,
      },
    });
  }

  const base = localBase();
  console.log("\n✓ Ninjas / Nuno replica seeded");
  console.log(`  Event:   ${base}/events/${event.id}`);
  console.log(`  Sign in: ${DEMO_EMAIL} / demo123  (named "${NUNO_NAME}", rating 934)`);
  console.log("  Expected last-game delta: +184 RP (underdog win, E≈0.424)\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
