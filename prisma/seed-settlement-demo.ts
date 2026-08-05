/**
 * Seed: payment settlement demo (new per-game payment model).
 *
 * Creates two events owned by the demo user that exercise the settlement flow:
 *  1. An UPCOMING event with a tracked game, a player-payer set, and a mix of
 *     pending/sent/paid shares — shows the payments page with an unsettled game.
 *  2. A JUST-ENDED event (no payer yet, all pending) — shows the "who paid this
 *     game?" config prompt + settle actions on the payments page.
 *
 * Run: npm run db:seed:settlement
 * Sign in: demo@convocados.app / demo123
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_PASSWORD_HASH = "e85e17b8ccf0231ecc33406b98bf41b3:ac313125f11ad360382987c4c993c93d0346878a4ae3959669711822323fb8c5ac57f53975466b90b60f38ab5e81c263bbabcd821cab003641e4342f92e9dc45";

const PLAYERS = ["Ana", "Bruno", "Carla", "Diogo", "Elena", "Filipe"];
const COST = 60;
const SHARE = Math.round((COST / PLAYERS.length) * 100) / 100;

async function ensureDemoUser() {
  const email = "demo@convocados.app";
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      id: "demo-settlement-001",
      name: "Demo Organizer",
      email,
      emailVerified: true,
    },
  });
  const existing = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (!existing) {
    await prisma.account.create({
      data: {
        id: `account-${user.id}`,
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: DEMO_PASSWORD_HASH,
      },
    });
  }
  return user;
}

async function createEvent(opts: { title: string; dateTime: Date; ownerId: string; status?: string }) {
  const event = await prisma.event.create({
    data: {
      title: opts.title,
      location: "Riverside Astro, Pitch 2",
      dateTime: opts.dateTime,
      maxPlayers: 6,
      sport: "football-5v5",
      durationMinutes: 60,
      isPublic: true,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId: opts.ownerId,
    },
  });
  const game = await prisma.game.create({
    data: {
      eventId: event.id,
      dateTime: opts.dateTime,
      status: opts.status ?? "upcoming",
    },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

  for (let i = 0; i < PLAYERS.length; i++) {
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: PLAYERS[i], userId: null },
    });
    await prisma.gameParticipant.create({
      data: { gameId: game.id, eventPlayerId: ep.id, order: i },
    });
  }

  await prisma.eventCost.create({
    data: { eventId: event.id, totalAmount: COST, currency: "EUR" },
  });

  return { event, game };
}

async function main() {
  const user = await ensureDemoUser();
  const now = Date.now();

  // 1. Upcoming event — tracked, Ana is the payer, Bruno paid, Carla sent, rest pending.
  const upcoming = await createEvent({
    title: "Payment Settlement Demo (upcoming)",
    dateTime: new Date(now + 2 * 86400_000),
    ownerId: user.id,
  });
  const upcomingAna = await prisma.eventPlayer.findFirstOrThrow({
    where: { eventId: upcoming.event.id, name: "Ana" },
  });
  await prisma.game.update({
    where: { id: upcoming.game.id },
    data: { paymentMode: "tracked", payerEventPlayerId: upcomingAna.id },
  });
  const { syncGamePayments } = await import("../src/lib/settlement.server");
  await syncGamePayments(upcoming.game.id, upcoming.event.id);
  // Mix statuses: Bruno paid, Carla sent, rest pending.
  const bruno = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: upcoming.event.id, name: "Bruno" } });
  const carla = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: upcoming.event.id, name: "Carla" } });
  await prisma.gamePayment.updateMany({
    where: { gameId: upcoming.game.id, eventPlayerId: bruno.id },
    data: { status: "paid", paidAt: new Date(), markedBy: user.id },
  });
  await prisma.gamePayment.updateMany({
    where: { gameId: upcoming.game.id, eventPlayerId: carla.id },
    data: { status: "sent" },
  });

  // 2. Just-ended event — tracked, no payer set, all pending (config prompt).
  const ended = await createEvent({
    title: "Payment Settlement Demo (just ended)",
    dateTime: new Date(now - 60 * 60 * 1000),
    ownerId: user.id,
    status: "played",
  });
  await syncGamePayments(ended.game.id, ended.event.id);

  console.log(`\n  ** PAYMENT SETTLEMENT DEMO EVENTS:`);
  console.log(`     Upcoming:  ${upcoming.event.id}  "${upcoming.event.title}"`);
  console.log(`       URL: /events/${upcoming.event.id}/payments`);
  console.log(`     Just ended: ${ended.event.id}  "${ended.event.title}"`);
  console.log(`       URL: /events/${ended.event.id}/payments`);
  console.log(`     Sign in: demo@convocados.app / demo123`);
  console.log(`     Share: ${SHARE.toFixed(2)}€ × ${PLAYERS.length} players`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
