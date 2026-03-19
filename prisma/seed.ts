/**
 * Seed script — inserts 100 sample events into the dev SQLite database.
 *
 * Usage:  npm run db:seed
 *
 * Each event gets a random sport, 4-12 players, a location, and a date
 * spread across the next 30 days (some in the past for history testing).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SPORTS = [
  "football-5v5",
  "football-7v7",
  "football-11v11",
  "futsal",
  "basketball",
  "volleyball",
  "tennis-singles",
  "tennis-doubles",
  "padel",
  "other",
];

const LOCATIONS = [
  "Riverside Astro, Pitch 1",
  "Central Park Courts",
  "Downtown Sports Hall",
  "Beachside Arena",
  "University Gym",
  "Olympic Stadium, Field B",
  "Sunset Recreation Center",
  "Hilltop Tennis Club",
  "Padel World, Court 3",
  "Community Center Gym",
  "Eastside Football Ground",
  "Lakefront Sports Complex",
  "",
];

const FIRST_NAMES = [
  "Alex", "Bruno", "Carlos", "Diana", "Elena", "Fábio", "Gonçalo", "Helena",
  "Igor", "Joana", "Kevin", "Lara", "Miguel", "Nuno", "Olga", "Pedro",
  "Quim", "Rita", "Sofia", "Tiago", "Ursula", "Vasco", "Wanda", "Xavier",
  "Yara", "Zé", "André", "Beatriz", "Catarina", "Diogo", "Eva", "Filipe",
  "Gustavo", "Inês", "Jorge", "Kátia", "Luís", "Marta", "Nelson", "Patrícia",
];

const TITLE_TEMPLATES = [
  "{day} {sport} session",
  "{sport} — {location}",
  "Weekly {sport}",
  "{sport} pickup game",
  "Casual {sport} match",
  "{day} night {sport}",
  "Lunchtime {sport}",
  "{sport} tournament",
  "Friendly {sport}",
  "{sport} league game",
];

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const SPORT_LABELS: Record<string, string> = {
  "football-5v5": "Football 5v5",
  "football-7v7": "Football 7v7",
  "football-11v11": "Football 11v11",
  futsal: "Futsal",
  basketball: "Basketball",
  volleyball: "Volleyball",
  "tennis-singles": "Tennis",
  "tennis-doubles": "Tennis Doubles",
  padel: "Padel",
  other: "Sports",
};

const SPORT_MAX_PLAYERS: Record<string, number> = {
  "football-5v5": 10,
  "football-7v7": 14,
  "football-11v11": 22,
  futsal: 10,
  basketball: 10,
  volleyball: 12,
  "tennis-singles": 2,
  "tennis-doubles": 4,
  padel: 4,
  other: 10,
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateTitle(sport: string, location: string): string {
  const template = pick(TITLE_TEMPLATES);
  const day = pick(DAYS);
  const sportLabel = SPORT_LABELS[sport] ?? "Sports";
  const loc = location || "TBD";
  return template
    .replace("{day}", day)
    .replace("{sport}", sportLabel)
    .replace("{location}", loc);
}

function uniqueNames(count: number): string[] {
  const shuffled = [...FIRST_NAMES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

async function main() {
  console.log("Seeding 100 sample events...\n");

  const now = Date.now();

  for (let i = 0; i < 100; i++) {
    const sport = pick(SPORTS);
    const location = pick(LOCATIONS);
    const maxPlayers = SPORT_MAX_PLAYERS[sport] ?? 10;

    // Spread dates: ~30% in the past, ~70% in the future
    const offsetDays = randInt(-10, 30);
    const offsetHours = randInt(8, 22); // games between 8am and 10pm
    const dateTime = new Date(now + offsetDays * 86400000);
    dateTime.setHours(offsetHours, 0, 0, 0);

    const title = generateTitle(sport, location);
    const isPublic = Math.random() < 0.4;
    const isRecurring = Math.random() < 0.25;
    const balanced = Math.random() < 0.2;

    const recurrenceRule = isRecurring
      ? JSON.stringify({ freq: "weekly", interval: 1 })
      : null;

    const playerCount = randInt(Math.min(4, maxPlayers), maxPlayers);
    const playerNames = uniqueNames(playerCount);

    const event = await prisma.event.create({
      data: {
        title,
        location,
        dateTime,
        maxPlayers,
        sport,
        isPublic,
        isRecurring,
        balanced,
        recurrenceRule,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        players: {
          create: playerNames.map((name, order) => ({ name, order })),
        },
      },
    });

    const status = offsetDays < 0 ? "(past)" : offsetDays === 0 ? "(today)" : "(upcoming)";
    console.log(
      `  [${String(i + 1).padStart(3)}] ${event.id}  ${title.padEnd(40)} ${playerCount}/${maxPlayers} players  ${status}`
    );
  }

  console.log("\nDone — 100 events created.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
