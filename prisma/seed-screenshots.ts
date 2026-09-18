/**
 * Deterministic screenshot fixture.
 *
 * Usage (against a throwaway database — never the dev DB):
 *   CONVOCADOS_FIXED_NOW=2026-03-14T18:00:00.000Z \
 *   DATABASE_URL=file:./screenshots.db \
 *   node_modules/.bin/tsx prisma/seed-screenshots.ts
 *
 * Unlike `prisma/seed.ts`, every value here is fixed: no faker, no
 * `Math.random`, no wall-clock-relative dates. All timestamps derive from
 * `CONVOCADOS_FIXED_NOW` so the server (via `src/lib/now.ts`), the seed, and
 * the Playwright capture all agree on "now". That agreement is what makes
 * `docs/screenshots/web/*` byte-stable across runs.
 *
 * See docs/adr/0037-ci-owned-readme-screenshots.md.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FIXED_NOW = process.env.CONVOCADOS_FIXED_NOW ?? "2026-03-14T18:00:00.000Z";
const ANCHOR = new Date(FIXED_NOW);

// Pre-computed scrypt hash for "demo123" (generated via better-auth's hashPassword)
const DEMO_PASSWORD_HASH =
  "e85e17b8ccf0231ecc33406b98bf41b3:ac313125f11ad360382987c4c993c93d0346878a4ae3959669711822323fb8c5ac57f53975466b90b60f38ab5e81c263bbabcd821cab003641e4342f92e9dc45";

const DEMO_USER_ID = "demo-organizer-001";
const DEMO_EMAIL = "demo@convocados.app";

const HERO_EVENT_ID = "screenshot-hero";
const PAST_EVENT_IDS = ["screenshot-past-1", "screenshot-past-2", "screenshot-past-3", "screenshot-past-4"];
const PUBLIC_EVENT_IDS = [
  "screenshot-public-1",
  "screenshot-public-2",
  "screenshot-public-3",
  "screenshot-public-4",
  "screenshot-public-5",
];
const FOLLOWED_EVENT_ID = "screenshot-public-1";

const ROSTER = [
  "Alex Moreira",
  "Bruno Costa",
  "Carlos Dias",
  "Diogo Fonseca",
  "Eduardo Lopes",
  "Filipe Nunes",
  "Gonçalo Reis",
  "Hugo Martins",
  "Ivo Tavares",
  "João Silva",
];

const TEAM_ONE = ROSTER.slice(0, 5);
const TEAM_TWO = ROSTER.slice(5);

/** Fixed instant, `offsetDays` from the anchor, at `hour` UTC. */
function at(offsetDays: number, hour = 19): Date {
  const d = new Date(ANCHOR.getTime() + offsetDays * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

interface PublicFixture {
  id: string;
  title: string;
  location: string;
  lat: number;
  lng: number;
  sport: string;
  maxPlayers: number;
  offsetDays: number;
  hour: number;
  players: string[];
}

const PUBLIC_FIXTURES: PublicFixture[] = [
  {
    id: PUBLIC_EVENT_IDS[0],
    title: "Sunday Morning Futsal",
    location: "Pavilhão Municipal, Court 1",
    lat: 38.7369,
    lng: -9.1427,
    sport: "futsal",
    maxPlayers: 10,
    offsetDays: 1,
    hour: 10,
    players: ["Miguel Sousa", "Nuno Rocha", "Paulo Mendes", "Rui Castro", "Sérgio Pinto", "Tiago Neves"],
  },
  {
    id: PUBLIC_EVENT_IDS[1],
    title: "Tuesday Night Basketball",
    location: "Arena Lisboa, Court B",
    lat: 38.7675,
    lng: -9.0945,
    sport: "basketball",
    maxPlayers: 10,
    offsetDays: 3,
    hour: 21,
    players: ["André Gomes", "Bernardo Lima", "César Matos", "Daniel Reis", "Egas Braga"],
  },
  {
    id: PUBLIC_EVENT_IDS[2],
    title: "Thursday Padel Doubles",
    location: "Padel Factory, Court 3",
    lat: 38.7063,
    lng: -9.1805,
    sport: "padel",
    maxPlayers: 4,
    offsetDays: 5,
    hour: 20,
    players: ["Fernando Amaral", "Gil Esteves", "Henrique Vidal", "Inácio Pires"],
  },
  {
    id: PUBLIC_EVENT_IDS[3],
    title: "Weekend 7-a-side",
    location: "Astro Turf Oeiras, Pitch 1",
    lat: 38.6867,
    lng: -9.3156,
    sport: "football-7v7",
    maxPlayers: 14,
    offsetDays: 6,
    hour: 11,
    players: [
      "Jorge Freitas",
      "Kevin Alves",
      "Luís Barros",
      "Marco Tavares",
      "Nélson Cunha",
      "Óscar Pimenta",
      "Pedro Sá",
      "Quim Roque",
    ],
  },
  {
    id: PUBLIC_EVENT_IDS[4],
    title: "Monday Volleyball",
    location: "Praia de Carcavelos, Net 2",
    lat: 38.6799,
    lng: -9.338,
    sport: "volleyball",
    maxPlayers: 12,
    offsetDays: 9,
    hour: 18,
    players: ["Rita Nunes", "Sofia Pires", "Tomás Aragão", "Ubaldo Reis", "Vasco Melo", "Xavier Godinho"],
  },
];

async function resetFixtureData() {
  const eventIds = [HERO_EVENT_ID, ...PAST_EVENT_IDS, ...PUBLIC_EVENT_IDS];
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { ownerId: DEMO_USER_ID } });
  await prisma.account.deleteMany({ where: { userId: DEMO_USER_ID } });
  await prisma.user.deleteMany({ where: { id: DEMO_USER_ID } });
}

async function seedDemoUser() {
  await prisma.user.create({
    data: {
      id: DEMO_USER_ID,
      name: "Demo Organizer",
      email: DEMO_EMAIL,
      emailVerified: true,
      pushPromptState: "dismissed",
      pushPromptLastDismissedAt: at(-1, 12),
      createdAt: at(-200, 12),
    },
  });
  await prisma.account.create({
    data: {
      id: `account-${DEMO_USER_ID}`,
      accountId: DEMO_USER_ID,
      providerId: "credential",
      issuer: "local:credential",
      userId: DEMO_USER_ID,
      password: DEMO_PASSWORD_HASH,
      createdAt: at(-200, 12),
    },
  });
}

async function seedHeroEvent() {
  const dateTime = at(3, 19);
  await prisma.event.create({
    data: {
      id: HERO_EVENT_ID,
      title: "Saturday 5-a-side",
      location: "Campo Municipal, Pitch 2",
      latitude: 38.7223,
      longitude: -9.1393,
      dateTime,
      timezone: "Europe/Lisbon",
      maxPlayers: 10,
      sport: "football-5v5",
      durationMinutes: 60,
      isPublic: true,
      balanced: true,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId: DEMO_USER_ID,
      createdAt: at(-12, 9),
      players: { create: ROSTER.map((name, order) => ({ name, order })) },
      teamResults: {
        create: [
          { name: "Ninjas", members: { create: TEAM_ONE.map((name, order) => ({ name, order })) } },
          { name: "Gunas", members: { create: TEAM_TWO.map((name, order) => ({ name, order })) } },
        ],
      },
      playerRatings: {
        create: ROSTER.map((name, i) => ({
          name,
          rating: 1000 + i * 17,
          gamesPlayed: 4,
          wins: 2 + (i % 2),
          draws: 1,
          losses: 1 - (i % 2),
        })),
      },
      eventCost: {
        create: {
          totalAmount: 60,
          currency: "EUR",
          paymentDetails: "MB Way @demo-organizer",
          payments: {
            create: ROSTER.map((name, i) => ({
              playerName: name,
              amount: 6,
              status: i < 6 ? "paid" : "pending",
              method: i < 6 ? ["mbway", "cash", "transfer"][i % 3] : null,
              paidAt: i < 6 ? at(-1, 20) : null,
            })),
          },
        },
      },
      eventLogs: {
        create: [
          { action: "event_created", actor: "Demo Organizer", actorId: DEMO_USER_ID, details: "{}", createdAt: at(-12, 9) },
          { action: "player_added", actor: "Demo Organizer", actorId: DEMO_USER_ID, details: JSON.stringify({ name: "Alex Moreira" }), createdAt: at(-11, 10) },
          { action: "teams_randomized", actor: "Demo Organizer", actorId: DEMO_USER_ID, details: "{}", createdAt: at(-2, 18) },
          { action: "cost_set", actor: "Demo Organizer", actorId: DEMO_USER_ID, details: JSON.stringify({ totalAmount: 60 }), createdAt: at(-1, 12) },
        ],
      },
    },
  });
}

async function seedPastEvents() {
  const scores = [
    { one: 5, two: 3 },
    { one: 4, two: 4 },
    { one: 6, two: 2 },
    { one: 3, two: 5 },
  ];
  for (let i = 0; i < PAST_EVENT_IDS.length; i += 1) {
    const eventId = PAST_EVENT_IDS[i];
    const gameDate = at(-(7 * (i + 1)), 19);
    const teamsSnapshot = JSON.stringify([
      { team: "Ninjas", players: TEAM_ONE.map((name, order) => ({ name, order })) },
      { team: "Gunas", players: TEAM_TWO.map((name, order) => ({ name, order })) },
    ]);
    const paymentsSnapshot = JSON.stringify(
      ROSTER.map((name, j) => ({
        playerName: name,
        amount: 6,
        status: i % 2 === 0 || j < 5 ? "paid" : "pending",
        method: i % 2 === 0 || j < 5 ? "mbway" : null,
      })),
    );
    await prisma.event.create({
      data: {
        id: eventId,
        title: `Saturday 5-a-side — week ${4 - i}`,
        location: "Campo Municipal, Pitch 2",
        latitude: 38.7223,
        longitude: -9.1393,
        dateTime: gameDate,
        timezone: "Europe/Lisbon",
        maxPlayers: 10,
        sport: "football-5v5",
        durationMinutes: 60,
        isPublic: false,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        ownerId: DEMO_USER_ID,
        createdAt: at(-(7 * (i + 1) + 5), 9),
        players: { create: ROSTER.map((name, order) => ({ name, order })) },
        history: {
          create: {
            dateTime: gameDate,
            status: "played",
            scoreOne: scores[i].one,
            scoreTwo: scores[i].two,
            teamOneName: "Ninjas",
            teamTwoName: "Gunas",
            teamsSnapshot,
            paymentsSnapshot,
            eloProcessed: true,
            createdAt: gameDate,
          },
        },
      },
    });
  }
}

async function seedPublicEvents() {
  for (const fixture of PUBLIC_FIXTURES) {
    await prisma.event.create({
      data: {
        id: fixture.id,
        title: fixture.title,
        location: fixture.location,
        latitude: fixture.lat,
        longitude: fixture.lng,
        dateTime: at(fixture.offsetDays, fixture.hour),
        timezone: "Europe/Lisbon",
        maxPlayers: fixture.maxPlayers,
        sport: fixture.sport,
        durationMinutes: 60,
        isPublic: true,
        createdAt: at(-5, 9),
        players: { create: fixture.players.map((name, order) => ({ name, order })) },
      },
    });
  }
}

async function seedFollow() {
  await prisma.eventFollow.create({
    data: {
      eventId: FOLLOWED_EVENT_ID,
      userId: DEMO_USER_ID,
      createdAt: at(-4, 12),
    },
  });
}

async function main() {
  console.log(`Seeding screenshot fixture (fixed now = ${ANCHOR.toISOString()})...`);
  await resetFixtureData();
  await seedDemoUser();
  await seedHeroEvent();
  await seedPastEvents();
  await seedPublicEvents();
  await seedFollow();

  const events = await prisma.event.count();
  const history = await prisma.gameHistory.count();
  console.log(`Done — ${events} events, ${history} game history entries.`);
  console.log(`  Hero event:  /events/${HERO_EVENT_ID}`);
  console.log(`  Sign in:     ${DEMO_EMAIL} / demo123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
