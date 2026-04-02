/**
 * Seed script — inserts 100 sample events into the dev SQLite database.
 *
 * Usage:  npm run db:seed
 *
 * Each event gets a random sport, 4-12 players, a location, and a date
 * spread across the next 30 days (some in the past for history testing).
 *
 * Past events also get:
 * - Game history with scores and team snapshots
 * - ELO player ratings (accumulated across games)
 * - Event costs with payment records (some paid, some pending)
 */

import { PrismaClient } from "@prisma/client";
import { computeGameUpdates } from "../src/lib/elo";
import { getDefaultDurationMinutes } from "../src/lib/sports";

const prisma = new PrismaClient();

// Pre-computed scrypt hash for "demo123" (generated via better-auth's hashPassword)
const DEMO_PASSWORD_HASH = "e85e17b8ccf0231ecc33406b98bf41b3:ac313125f11ad360382987c4c993c93d0346878a4ae3959669711822323fb8c5ac57f53975466b90b60f38ab5e81c263bbabcd821cab003641e4342f92e9dc45";

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

  // Track cumulative ELO ratings across all past games per event
  // Map<eventId, Map<playerName, {rating, gamesPlayed, wins, draws, losses}>>
  const eloByEvent = new Map<string, Map<string, { rating: number; gamesPlayed: number; wins: number; draws: number; losses: number }>>();

  const COST_AMOUNTS = [30, 40, 50, 60, 75, 80, 100, 120];
  const PAYMENT_METHODS = ["revolut", "mbway", "cash", "transfer", null];
  const PAYMENT_DETAILS = [
    "Revolut @jose / MB Way 912345678",
    "IBAN PT50 0035 1234 5678 9012 345",
    "Cash on arrival",
    "Bizum +34 612 345 678",
    null,
  ];

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
        durationMinutes: getDefaultDurationMinutes(sport),
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

    const isPast = offsetDays < 0;
    const status = isPast ? "(past)" : offsetDays === 0 ? "(today)" : "(upcoming)";

    // ── Past events: add game history, teams, elo, and payments ──────────
    // Recurring events get multiple game history entries (simulating weeks of play)
    // Public events always get a recent game (yesterday) so editableUntil is in the future
    const needsRecentGame = isPublic && playerNames.length >= 4;
    const gameCount = isPast && playerNames.length >= 4
      ? isRecurring ? randInt(4, 12) : 1
      : needsRecentGame ? 1 : 0;

    if (gameCount > 0) {
      // ELO ratings — accumulate across games for this event
      if (!eloByEvent.has(event.id)) {
        eloByEvent.set(event.id, new Map());
      }
      const eventRatings = eloByEvent.get(event.id)!;

      // Payment data for the live event cost (only once, not per game)
      const hasCost = Math.random() < 0.6;

      for (let g = 0; g < gameCount; g++) {
        // Each game is 7 days apart going back in time
        // For public events, the most recent game (g===0) is yesterday so editableUntil is in the future
        const gameDateTime = needsRecentGame && g === 0
          ? new Date(now - 86400000)
          : new Date(dateTime.getTime() - g * 7 * 86400000);

        // Vary the roster per game: some players may miss some games (70-100% attendance)
        const allPlayers = playerNames.slice(0, maxPlayers);
        const gamePlayers = allPlayers.filter(() => Math.random() < (0.7 + Math.random() * 0.3));
        // Ensure at least 4 players
        while (gamePlayers.length < 4 && gamePlayers.length < allPlayers.length) {
          const missing = allPlayers.find((p) => !gamePlayers.includes(p));
          if (missing) gamePlayers.push(missing);
          else break;
        }

        const half = Math.floor(gamePlayers.length / 2);
        const teamOnePlayers = gamePlayers.slice(0, half);
        const teamTwoPlayers = gamePlayers.slice(half);

        const teamsSnapshot = JSON.stringify([
          { team: "Ninjas", players: teamOnePlayers.map((name, order) => ({ name, order })) },
          { team: "Gunas", players: teamTwoPlayers.map((name, order) => ({ name, order })) },
        ]);

        const scoreOne = randInt(0, 8);
        const scoreTwo = randInt(0, 8);

        // Create team results (only for the most recent game)
        if (g === 0) {
          await prisma.teamResult.create({
            data: {
              name: "Ninjas",
              eventId: event.id,
              members: {
                create: teamOnePlayers.map((name, order) => ({ name, order })),
              },
            },
          });
          await prisma.teamResult.create({
            data: {
              name: "Gunas",
              eventId: event.id,
              members: {
                create: teamTwoPlayers.map((name, order) => ({ name, order })),
              },
            },
          });
        }

        // Payment snapshot for history
        let paymentsSnapshot: string | null = null;
        if (hasCost) {
          const totalAmount = pick(COST_AMOUNTS);
          const share = totalAmount / gamePlayers.length;
          const paymentSnapshotData = gamePlayers.map((name) => {
            const roll = Math.random();
            const pStatus = roll < 0.5 ? "paid" : "pending";
            return {
              playerName: name,
              amount: Math.round(share * 100) / 100,
              status: pStatus,
              method: pStatus === "paid" ? pick(PAYMENT_METHODS) : null,
            };
          });
          paymentsSnapshot = JSON.stringify(paymentSnapshotData);
        }

        // Game history
        const editableUntil = new Date(gameDateTime.getTime() + 7 * 86400000);
        await prisma.gameHistory.create({
          data: {
            eventId: event.id,
            dateTime: gameDateTime,
            status: "played",
            scoreOne,
            scoreTwo,
            teamOneName: "Ninjas",
            teamTwoName: "Gunas",
            teamsSnapshot,
            paymentsSnapshot,
            editableUntil,
            eloProcessed: true,
          },
        });

        // Build player info for elo computation
        const playerInfos = gamePlayers.map((name) => {
          const existing = eventRatings.get(name);
          return {
            name,
            rating: existing?.rating ?? 1000,
            gamesPlayed: existing?.gamesPlayed ?? 0,
          };
        });

        const teams = [
          { team: "Ninjas", players: teamOnePlayers.map((name, order) => ({ name, order })) },
          { team: "Gunas", players: teamTwoPlayers.map((name, order) => ({ name, order })) },
        ];

        const eloUpdates = computeGameUpdates(playerInfos, teams, scoreOne, scoreTwo);

        for (const update of eloUpdates) {
          const isTeamOne = teamOnePlayers.includes(update.name);
          const won = isTeamOne ? scoreOne > scoreTwo : scoreTwo > scoreOne;
          const drew = scoreOne === scoreTwo;

          const prev = eventRatings.get(update.name) ?? {
            rating: 1000, gamesPlayed: 0, wins: 0, draws: 0, losses: 0,
          };

          eventRatings.set(update.name, {
            rating: update.newRating,
            gamesPlayed: prev.gamesPlayed + 1,
            wins: prev.wins + (won ? 1 : 0),
            draws: prev.draws + (drew ? 1 : 0),
            losses: prev.losses + (!won && !drew ? 1 : 0),
          });
        }
      }

      // Write player ratings to DB
      for (const [name, stats] of eventRatings) {
        await prisma.playerRating.upsert({
          where: { eventId_name: { eventId: event.id, name } },
          create: {
            eventId: event.id,
            name,
            rating: stats.rating,
            gamesPlayed: stats.gamesPlayed,
            wins: stats.wins,
            draws: stats.draws,
            losses: stats.losses,
          },
          update: {
            rating: stats.rating,
            gamesPlayed: stats.gamesPlayed,
            wins: stats.wins,
            draws: stats.draws,
            losses: stats.losses,
          },
        });
      }

      // Live event cost + payments (once per event)
      if (hasCost) {
        const activePlayers = playerNames.slice(0, maxPlayers);
        const totalAmount = pick(COST_AMOUNTS);
        const share = totalAmount / activePlayers.length;
        const paymentDetail = pick(PAYMENT_DETAILS);

        const eventCost = await prisma.eventCost.create({
          data: {
            eventId: event.id,
            totalAmount,
            currency: "EUR",
            paymentDetails: paymentDetail,
          },
        });

        for (const name of activePlayers) {
          const roll = Math.random();
          const pStatus = roll < 0.5 ? "paid" : "pending";
          await prisma.playerPayment.create({
            data: {
              eventCostId: eventCost.id,
              playerName: name,
              amount: Math.round(share * 100) / 100,
              status: pStatus,
              method: pStatus === "paid" ? pick(PAYMENT_METHODS) : null,
              paidAt: pStatus === "paid" ? dateTime : null,
            },
          });
        }
      }

      console.log(
        `  [${String(i + 1).padStart(3)}] ${event.id}  ${title.padEnd(40)} ${playerCount}/${maxPlayers} players  ${status}  ${gameCount} games${hasCost ? "  $" : ""}`
      );
    } else {
      console.log(
        `  [${String(i + 1).padStart(3)}] ${event.id}  ${title.padEnd(40)} ${playerCount}/${maxPlayers} players  ${status}`
      );
    }
  }

  // ── Guaranteed "just ended" event for post-game banner testing ────────────
  // This event ended ~30 minutes ago, has players, teams, cost with pending
  // payments, but NO score yet — so the post-game banner will appear.
  // Owned by a demo user so the score can be edited after signing in.
  {
    // Create (or reuse) a demo user for the just-ended event
    const demoEmail = "demo@convocados.app";
    const demoUser = await prisma.user.upsert({
      where: { email: demoEmail },
      update: {},
      create: {
        id: "demo-organizer-001",
        name: "Demo Organizer",
        email: demoEmail,
        emailVerified: true,
      },
    });

    // Create credential account so the demo user can sign in
    const demoPassword = "demo123";
    const existingAccount = await prisma.account.findFirst({
      where: { userId: demoUser.id, providerId: "credential" },
    });
    if (!existingAccount) {
      await prisma.account.create({
        data: {
          id: `account-${demoUser.id}`,
          accountId: demoUser.id,
          providerId: "credential",
          userId: demoUser.id,
          password: DEMO_PASSWORD_HASH,
        },
      });
    }

    const justEndedDate = new Date(now - 90 * 60 * 1000); // started 90 min ago
    const justEndedSport = "football-5v5";
    const justEndedMaxPlayers = 10;
    const justEndedPlayers = uniqueNames(justEndedMaxPlayers);
    const half = Math.floor(justEndedPlayers.length / 2);
    const teamOne = justEndedPlayers.slice(0, half);
    const teamTwo = justEndedPlayers.slice(half);

    const justEndedEvent = await prisma.event.create({
      data: {
        title: "Just Ended — Close the Game!",
        location: "Riverside Astro, Pitch 1",
        dateTime: justEndedDate,
        maxPlayers: justEndedMaxPlayers,
        sport: justEndedSport,
        durationMinutes: getDefaultDurationMinutes(justEndedSport),
        isPublic: true,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        ownerId: demoUser.id,
        players: {
          create: justEndedPlayers.map((name, order) => ({ name, order })),
        },
      },
    });

    // Create team results so the event page shows teams
    await prisma.teamResult.create({
      data: {
        name: "Ninjas",
        eventId: justEndedEvent.id,
        members: { create: teamOne.map((name, order) => ({ name, order })) },
      },
    });
    await prisma.teamResult.create({
      data: {
        name: "Gunas",
        eventId: justEndedEvent.id,
        members: { create: teamTwo.map((name, order) => ({ name, order })) },
      },
    });

    // Create a GameHistory record WITHOUT scores — this is what the user
    // needs to fill in. The post-game banner's "Add score" button links
    // to the history page where this entry will be editable.
    const teamsSnapshot = JSON.stringify([
      { team: "Ninjas", players: teamOne.map((name, order) => ({ name, order })) },
      { team: "Gunas", players: teamTwo.map((name, order) => ({ name, order })) },
    ]);
    await prisma.gameHistory.create({
      data: {
        eventId: justEndedEvent.id,
        dateTime: justEndedDate,
        status: "played",
        scoreOne: null,
        scoreTwo: null,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        teamsSnapshot,
        editableUntil: new Date(now + 7 * 86400_000),
      },
    });

    // Add cost with ALL payments pending — banner will show both tasks
    const totalAmount = 60;
    const share = totalAmount / justEndedPlayers.length;
    const justEndedCost = await prisma.eventCost.create({
      data: {
        eventId: justEndedEvent.id,
        totalAmount,
        currency: "EUR",
        paymentDetails: "Revolut @jose / MB Way 912345678",
      },
    });
    for (const name of justEndedPlayers) {
      await prisma.playerPayment.create({
        data: {
          eventCostId: justEndedCost.id,
          playerName: name,
          amount: Math.round(share * 100) / 100,
          status: "pending",
        },
      });
    }

    console.log(`\n  ** JUST ENDED EVENT (post-game banner demo):`);
    console.log(`     ${justEndedEvent.id}  "${justEndedEvent.title}"`);
    console.log(`     ${justEndedPlayers.length} players, €${totalAmount} cost, all payments pending, no score`);
    console.log(`     URL: /events/${justEndedEvent.id}`);
    console.log(`     Sign in: ${demoEmail} / ${demoPassword}`);
  }

  const pastCount = await prisma.gameHistory.count();
  const ratingCount = await prisma.playerRating.count();
  const costCount = await prisma.eventCost.count();
  console.log(`\nDone — 100 events created.`);
  console.log(`  ${pastCount} game history entries`);
  console.log(`  ${ratingCount} player ratings`);
  console.log(`  ${costCount} events with costs/payments`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
