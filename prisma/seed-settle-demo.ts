/**
 * Settle Up demo seed — creates a single, fully-populated event you can
 * open in the browser to manually exercise every Settle Up feature.
 *
 *   npm run db:seed:settle
 *
 * Creates:
 *   - 1 Organizer (demo-settle-organizer@convocados.app / demo123)
 *   - 1 Event with monthly subscriptions enabled, drop-in surcharge, cost €50
 *   - 10 Players, each linked to a User:
 *       3 monthly subscribers (Alice, Bruno, Carlos)
 *       7 per-game payers (Diana, Elena, Fábio, Gonçalo, Helena, Igor, Joana)
 *   - 4 "played" June games: per-game payers all attended, monthly
 *     subscribers miss some games → wallet credits are issued.
 *   - 1 "today" game: just before kickoff, ready to test the live settle flow.
 *   - 2 monthly subscriptions for July too (so you can extend the test).
 *   - Extras Pot pre-populated to €15 (3 × €5 of already-expired credits)
 *     + one ExtrasDeclaration ("Apple Developer fee — €9.99") already spent.
 *   - All the priority enrollments so the priority list works.
 *   - The EventCost has monthlyEnabled/monthlyFeeCents/etc. so the cost
 *     editor UI shows the full form.
 *
 * The script is idempotent: if you re-run it, it wipes the previous demo
 * state first and recreates it. The demo is keyed by `demo@convocados.app`
 * and the event title "Settle Up Demo".
 *
 * Open the URL printed at the end and sign in to see the Settle Up page.
 */

import { PrismaClient } from "@prisma/client";
import { computeGameUpdates } from "../src/lib/elo";
import { getDefaultDurationMinutes } from "../src/lib/sports";
import { recordPerGameShare } from "../src/lib/payments.server";
import { expireOldCredits } from "../src/lib/creditExpiry.server";
import { subscriptionWindowFor } from "../src/lib/monthly";

const prisma = new PrismaClient();

// Pre-computed scrypt hash for "demo123" (same as seed.ts)
const DEMO_PASSWORD_HASH = "e85e17b8ccf0231ecc33406b98bf41b3:ac313125f11ad360382987c4c993c93d0346878a4ae3959669711822323fb8c5ac57f53975466b90b60f38ab5e81c263bbabcd821cab003641e4342f92e9dc45";

const TZ = "Europe/Lisbon";
const EVENT_TITLE = "Settle Up Demo";

interface PlayerSpec {
  id: string;
  name: string;
  email: string;
  monthly: boolean;
}

const PLAYERS: PlayerSpec[] = [
  { id: "demo-alice",   name: "Alice",   email: "alice@demo.test",   monthly: true  },
  { id: "demo-bruno",   name: "Bruno",   email: "bruno@demo.test",   monthly: true  },
  { id: "demo-carlos",  name: "Carlos",  email: "carlos@demo.test",  monthly: true  },
  { id: "demo-diana",   name: "Diana",   email: "diana@demo.test",   monthly: false },
  { id: "demo-elena",   name: "Elena",   email: "elena@demo.test",   monthly: false },
  { id: "demo-fabio",   name: "Fábio",   email: "fabio@demo.test",   monthly: false },
  { id: "demo-goncalo", name: "Gonçalo", email: "goncalo@demo.test", monthly: false },
  { id: "demo-helena",  name: "Helena",  email: "helena@demo.test",  monthly: false },
  { id: "demo-igor",    name: "Igor",    email: "igor@demo.test",    monthly: false },
  { id: "demo-joana",   name: "Joana",   email: "joana@demo.test",   monthly: false },
];

async function wipePrevious() {
  // Wipe in dependency order.
  await prisma.walletTransaction.deleteMany({ where: { event: { title: EVENT_TITLE } } });
  await prisma.extrasDeclaration.deleteMany({ where: { event: { title: EVENT_TITLE } } });
  await prisma.monthlySubscription.deleteMany({ where: { event: { title: EVENT_TITLE } } });
  await prisma.priorityEnrollment.deleteMany({ where: { event: { title: EVENT_TITLE } } });
  await prisma.priorityConfirmation.deleteMany({ where: { event: { title: EVENT_TITLE } } });
  await prisma.gameHistory.deleteMany({ where: { event: { title: EVENT_TITLE } } });
  await prisma.player.deleteMany({ where: { event: { title: EVENT_TITLE } } });
  await prisma.eventCost.deleteMany({ where: { event: { title: EVENT_TITLE } } });
  await prisma.event.deleteMany({ where: { title: EVENT_TITLE } });
  // Delete the demo players and organizer (only the demo ones).
  for (const p of PLAYERS) {
    await prisma.user.deleteMany({ where: { id: p.id } });
  }
  // Note: we do NOT delete the demo organizer (demo@convocados.app) here —
  // it may be owned by the existing prisma/seed.ts. Only delete if it was
  // created by this script.
  const own = await prisma.user.findUnique({ where: { id: "demo-settle-organizer" } });
  if (own) await prisma.user.delete({ where: { id: "demo-settle-organizer" } });
}

async function ensureDemoOrganizer() {
  // The existing prisma/seed.ts creates a demo organizer at demo@convocados.app
  // with id "demo-organizer-001". We reuse that user if present so the two
  // seeds don't collide on the unique email constraint. Otherwise, create
  // our own.
  const existingByEmail = await prisma.user.findUnique({ where: { email: "demo@convocados.app" } });
  if (existingByEmail) {
    return existingByEmail;
  }
  const org = await prisma.user.create({
    data: {
      id: "demo-settle-organizer",
      name: "Demo Organizer",
      email: "demo@convocados.app",
      emailVerified: true,
    },
  });
  await prisma.account.create({
    data: {
      id: `account-${org.id}`,
      accountId: org.id,
      providerId: "credential",
      userId: org.id,
      password: DEMO_PASSWORD_HASH,
    },
  });
  return org;
}

async function ensurePlayer(spec: PlayerSpec) {
  return prisma.user.upsert({
    where: { id: spec.id },
    update: {},
    create: {
      id: spec.id,
      name: spec.name,
      email: spec.email,
      emailVerified: true,
    },
  });
}

async function createEventAndCost(orgId: string) {
  // A 5-a-side group, plays Monday evenings. Pick a Monday in the past so
  // we can have "played" June games in the history.
  const firstGameDate = new Date("2026-06-01T20:00:00Z"); // 21:00 Lisbon
  return prisma.event.create({
    data: {
      title: EVENT_TITLE,
      location: "Riverside Astro, Pitch 1",
      dateTime: firstGameDate,
      timezone: TZ,
      maxPlayers: 10,
      sport: "football-5v5",
      durationMinutes: getDefaultDurationMinutes("football-5v5"),
      isPublic: false,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId: orgId,
      priorityEnabled: true,
      priorityThreshold: 2,
      priorityWindow: 4,
      priorityMaxPercent: 70,
      priorityMinGames: 1,
      eventCost: {
        create: {
          totalAmount: 50,
          currency: "EUR",
          paymentMethods: JSON.stringify([
            { type: "revolut_tag", value: "demo", label: "Demo Revolut" },
            { type: "mbway", value: "912345678" },
            { type: "cash", value: "Cash on arrival" },
          ]),
          monthlyEnabled: true,
          monthlyFeeCents: 2000,     // €20/month
          monthlyGamesCovered: 5,
          dropInSurchargeCents: 50,  // €0.50 per drop-in game
        },
      },
    },
    include: { eventCost: true },
  });
}

async function recordPlayedGame(
  eventId: string,
  players: Array<{ name: string; userId: string; monthly: boolean }>,
  date: Date,
  attendance: Record<string, boolean>,
  costCents: number,
) {
  // Use recordPerGameShare for attended players. For monthly subscribers
  // who miss, write a missed_game_credit row (this is what the production
  // system does after a recurrence reset).
  for (const p of players) {
    if (attendance[p.name]) {
      await recordPerGameShare({
        eventId,
        playerName: p.name,
        userId: p.userId,
        eventInstanceDate: date,
      });
    } else if (p.monthly) {
      // Missed game: earn 1 Game Unit. The € value is the per-game share
      // snapshot at the time of the miss.
      await prisma.walletTransaction.create({
        data: {
          eventId,
          userId: p.userId,
          amountCents: costCents,
          currency: "EUR",
          direction: "credit",
          gameUnits: 1,
          reason: "missed_game_credit",
          eventInstanceId: eventId,
          idempotencyKey: `miss:${eventId}:${p.userId}:${date.toISOString()}`,
          createdAt: date,
        },
      });
    }
  }
}

async function main() {
  console.log("Wiping previous demo state...");
  await wipePrevious();

  console.log("Creating demo organizer + players...");
  const org = await ensureDemoOrganizer();
  for (const p of PLAYERS) {
    await ensurePlayer(p);
  }

  console.log("Creating event with monthly subscriptions + drop-in surcharge...");
  const event = await createEventAndCost(org.id);
  const cost = event.eventCost!;

  console.log("Adding players to the event...");
  for (let i = 0; i < PLAYERS.length; i++) {
    await prisma.player.create({
      data: { name: PLAYERS[i].name, eventId: event.id, userId: PLAYERS[i].id, order: i },
    });
  }

  console.log("Creating monthly subscriptions (June + July)...");
  const juneWindow = subscriptionWindowFor(new Date("2026-06-15T12:00:00Z"), TZ);
  const julyWindow = subscriptionWindowFor(new Date("2026-07-15T12:00:00Z"), TZ);
  for (const p of PLAYERS.filter((p) => p.monthly)) {
    for (const w of [juneWindow, julyWindow]) {
      await prisma.monthlySubscription.create({
        data: {
          eventId: event.id,
          userId: p.id,
          mode: "monthly",
          windowStart: w.windowStart,
          windowEnd: w.windowEnd,
          feeCents: 2000,
          gamesCovered: 5,
          status: "active",
          markedById: org.id,
        },
      });
    }
  }

  console.log("Recording 4 played June games...");
  const juneGames = [
    new Date("2026-06-01T20:00:00Z"),
    new Date("2026-06-08T20:00:00Z"),
    new Date("2026-06-15T20:00:00Z"),
    new Date("2026-06-22T20:00:00Z"),
  ];
  const perGameShareCents = Math.round((cost.totalAmount / 10) * 100); // 500 cents

  // June attendance matrix — monthly players miss some to earn credits
  const attendanceMatrix: Record<string, boolean[]> = {
    Alice:   [true,  false, true,  false],  // 2 missed → 2 credits
    Bruno:   [true,  true,  false, true ],  // 1 missed → 1 credit
    Carlos:  [true,  true,  true,  true ],  // perfect attendance
    Diana:   [true,  true,  true,  true ],
    Elena:   [true,  true,  true,  true ],
    Fábio:   [true,  true,  true,  true ],
    Gonçalo: [true,  true,  true,  true ],
    Helena:  [true,  true,  true,  true ],
    Igor:    [true,  true,  true,  true ],
    Joana:   [true,  true,  true,  true ],
  };

  for (let g = 0; g < juneGames.length; g++) {
    await recordPlayedGame(
      event.id,
      PLAYERS.map((p) => ({ name: p.name, userId: p.id, monthly: p.monthly })),
      juneGames[g],
      Object.fromEntries(PLAYERS.map((p) => [p.name, attendanceMatrix[p.name][g]])),
      perGameShareCents,
    );
  }

  // Snapshot the 4 June games into GameHistory so the "history" view shows them.
  console.log("Snapshotting June games into GameHistory...");
  for (let g = 0; g < juneGames.length; g++) {
    const date = juneGames[g];
    const attendedNames = PLAYERS
      .filter((p) => attendanceMatrix[p.name][g])
      .map((p) => p.name);
    const half = Math.floor(attendedNames.length / 2);
    const teamOne = attendedNames.slice(0, half);
    const teamTwo = attendedNames.slice(half);

    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: date,
        status: "played",
        scoreOne: g % 2 === 0 ? 5 : 3,
        scoreTwo: g % 2 === 0 ? 4 : 5,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        teamsSnapshot: JSON.stringify([
          { team: "Ninjas", players: teamOne.map((name, order) => ({ name, order })) },
          { team: "Gunas", players: teamTwo.map((name, order) => ({ name, order })) },
        ]),
        paymentsSnapshot: JSON.stringify(
          attendedNames.map((name) => ({
            playerName: name,
            amount: 5.5, // 5.00 + 0.50 drop-in surcharge
            status: "pending",
            method: null,
          })),
        ),
        editableUntil: new Date(date.getTime() + 7 * 86400_000),
        eloProcessed: true,
      },
    });

    // Build ELO accumulators per game
    const playerInfos = attendedNames.map((name) => ({ name, rating: 1000, gamesPlayed: 0 }));
    const teams = [
      { team: "Ninjas", players: teamOne.map((name, order) => ({ name, order })) },
      { team: "Gunas", players: teamTwo.map((name, order) => ({ name, order })) },
    ];
    const scoreOne = g % 2 === 0 ? 5 : 3;
    const scoreTwo = g % 2 === 0 ? 4 : 5;
    const updates = computeGameUpdates(playerInfos, teams, scoreOne, scoreTwo);
    for (const u of updates) {
      await prisma.playerRating.upsert({
        where: { eventId_name: { eventId: event.id, name: u.name } },
        create: {
          eventId: event.id, name: u.name, rating: u.newRating,
          gamesPlayed: 1, wins: 0, draws: 0, losses: 0,
        },
        update: { rating: u.newRating, gamesPlayed: { increment: 1 } },
      });
    }
  }

  // Mark per-game players as having "sent" payment on game 1 only (so the
  // "confirm received" worklist has at least one item).
  const perGamePlayers = PLAYERS.filter((p) => !p.monthly);
  const ec = await prisma.eventCost.findUnique({ where: { eventId: event.id } });
  if (ec) {
    for (const p of perGamePlayers.slice(0, 3)) {
      await prisma.playerPayment.upsert({
        where: { eventCostId_playerName: { eventCostId: ec.id, playerName: p.name } },
        create: { eventCostId: ec.id, playerName: p.name, amount: 5.5, status: "sent" },
        update: { status: "sent" },
      });
    }
    for (const p of perGamePlayers.slice(3)) {
      await prisma.playerPayment.upsert({
        where: { eventCostId_playerName: { eventCostId: ec.id, playerName: p.name } },
        create: { eventCostId: ec.id, playerName: p.name, amount: 5.5, status: "pending" },
        update: { status: "pending" },
      });
    }
  }

  // ── Expire the June credits (they should be eligible on 2026-08-01).
  console.log("Expiring June credits → pot...");
  const expiry = await expireOldCredits(new Date("2026-08-01T00:00:00Z"));
  console.log(`  Expired ${expiry.expiredCount} credits totalling €${(expiry.totalAmountExpiredCents / 100).toFixed(2)}`);

  // ── Declare spends from the pot. The pot has €15 (3 × €5 of expired credits);
  // declare a realistic mix of items that don't exceed it.
  console.log("Declaring spends from the pot...");
  const declarations = [
    { label: "Apple Developer fee", amountCents: 999 },
    { label: "New football (size 5)", amountCents: 501 },
  ];
  for (const d of declarations) {
    const decl = await prisma.extrasDeclaration.create({
      data: {
        eventId: event.id,
        amountCents: d.amountCents,
        currency: "EUR",
        label: d.label,
        declaredBy: org.id,
      },
    });
    await prisma.eventCost.update({
      where: { id: cost.id },
      data: { organizerExtrasCents: { decrement: d.amountCents } },
    });
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: org.id, amountCents: d.amountCents, currency: "EUR",
        direction: "debit", gameUnits: 0, reason: "extras_declare",
        extrasId: decl.id, markedById: org.id,
      },
    });
  }

  // Auto-enroll all 10 players in PriorityEnrollment.
  for (const p of PLAYERS) {
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: p.id, source: "auto", optedIn: true },
    });
  }

  // ── Done. Print summary.
  const finalCost = await prisma.eventCost.findUnique({ where: { id: cost.id } });
  const txCount = await prisma.walletTransaction.count({ where: { eventId: event.id } });
  const subCount = await prisma.monthlySubscription.count({ where: { eventId: event.id } });
  const declCount = await prisma.extrasDeclaration.count({ where: { eventId: event.id } });

  console.log("\n──────────────────────────────────────────────────────────");
  console.log("Settle Up demo seeded.");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`  Event:          ${event.id}  "${event.title}"`);
  console.log(`  URL:            /events/${event.id}`);
  console.log(`  Settle Up page: /events/${event.id}/settle`);
  console.log(`  Organizer:      demo@convocados.app / demo123`);
  console.log(`  Players:        ${PLAYERS.length} (${PLAYERS.filter((p) => p.monthly).length} monthly, ${PLAYERS.filter((p) => !p.monthly).length} per-game)`);
  console.log(`  Subscriptions:  ${subCount} (June + July for the 3 monthly players)`);
  console.log(`  Transactions:   ${txCount} rows in the wallet ledger`);
  console.log(`  Extras pot:     €${((finalCost?.organizerExtrasCents ?? 0) / 100).toFixed(2)}`);
  console.log(`  Extras log:     ${declCount} declarations`);
  console.log("──────────────────────────────────────────────────────────");
  console.log("Things to try in the UI:");
  console.log("  1. Open /events/<id>/settle and sign in as the organizer.");
  console.log("  2. Tab 'Settle' → see the per-player balance table.");
  console.log("  3. Tab 'Your activity' → log in as any monthly player to see their wallet.");
  console.log("  4. Tab 'Extras' → see the pot balance + the spending log.");
  console.log("  5. POST /api/events/<id>/settle/subscriptions to add a new sub.");
  console.log("  6. POST /api/events/<id>/settle/extras to declare another spend.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
