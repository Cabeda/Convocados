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

  // 3. Post-game wrap-up demo owned by the real user (jecabeda@gmail.com):
  //    played game + score + a designated payer + a mix of paid/pending, so the
  //    wrap-up banner shows the "who paid" line and settleable payment pills.
  const realUser = await prisma.user.findUnique({ where: { email: "jecabeda@gmail.com" } });
  if (realUser) {
    const wrapPlayers = ["José Cabeda", "Ricardo", "Nuno", "Pedro", "Miguel", "André", "Tiago", "João"];
    const wrap = await prisma.event.create({
      data: {
        title: "Just Ended — Post-game Demo",
        location: "Riverside Astro, Pitch 1",
        dateTime: new Date(now - 75 * 60 * 1000),
        maxPlayers: 8,
        sport: "football-5v5",
        durationMinutes: 60,
        isPublic: true,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        ownerId: realUser.id,
      },
    });
    const wrapGame = await prisma.game.create({
      data: { eventId: wrap.id, dateTime: wrap.dateTime, status: "played", scoreOne: 5, scoreTwo: 3 },
    });
    await prisma.event.update({ where: { id: wrap.id }, data: { currentGameId: wrapGame.id } });
    for (let i = 0; i < wrapPlayers.length; i++) {
      const ep = await prisma.eventPlayer.create({
        data: { eventId: wrap.id, name: wrapPlayers[i], userId: wrapPlayers[i] === "José Cabeda" ? realUser.id : null },
      });
      await prisma.gameParticipant.create({ data: { gameId: wrapGame.id, eventPlayerId: ep.id, order: i } });
    }
    await prisma.eventCost.create({ data: { eventId: wrap.id, totalAmount: 80, currency: "EUR" } });
    await syncGamePayments(wrapGame.id, wrap.id);
    const josé = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: wrap.id, name: "José Cabeda" } });
    await prisma.game.update({
      where: { id: wrapGame.id },
      data: { paymentMode: "tracked", payerEventPlayerId: josé.id },
    });
    await syncGamePayments(wrapGame.id, wrap.id); // re-sync to auto-settle José as payer
    const richard = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: wrap.id, name: "Ricardo" } });
    const nuno = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: wrap.id, name: "Nuno" } });
    await prisma.gamePayment.updateMany({
      where: { gameId: wrapGame.id, eventPlayerId: richard.id },
      data: { status: "paid", paidAt: new Date(), markedBy: realUser.id },
    });
    await prisma.gamePayment.updateMany({
      where: { gameId: wrapGame.id, eventPlayerId: nuno.id },
      data: { status: "sent" },
    });
    const half = Math.ceil(wrapPlayers.length / 2);
    const teamOne = wrapPlayers.slice(0, half);
    const teamTwo = wrapPlayers.slice(half);
    await prisma.gameHistory.create({
      data: {
        eventId: wrap.id,
        dateTime: wrap.dateTime,
        status: "played",
        scoreOne: 5,
        scoreTwo: 3,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        teamsSnapshot: JSON.stringify([
          { team: "Ninjas", players: teamOne.map((name, order) => ({ name, order })) },
          { team: "Gunas", players: teamTwo.map((name, order) => ({ name, order })) },
        ]),
      },
    });
    console.log(`\n  ** POST-GAME WRAP-UP DEMO (owned by jecabeda@gmail.com):`);
    console.log(`     ${wrap.id}  "${wrap.title}"`);
    console.log(`     URL: /events/${wrap.id}`);
  }

  // 4. Complex multi-game settlement demo: two played games, different payers,
  //    overlapping debtors — Ana paid game 1 but owes game 2; Bruno paid both;
  //    Diogo owes both. No netting, so the payments page shows gross amounts.
  const multiOwner = realUser ?? user;
  {
    const multiNames = ["Ana", "Bruno", "Carla", "Diogo", "Elena", "Filipe"];
    const multi = await prisma.event.create({
      data: {
        title: "Multi-game Settlement Demo",
        location: "Riverside Astro, Pitch 3",
        dateTime: new Date(now - 7 * 86400_000),
        maxPlayers: 6,
        sport: "football-5v5",
        durationMinutes: 60,
        isPublic: true,
        ownerId: multiOwner.id,
      },
    });
    const multiPlayers: { id: string }[] = [];
    for (let i = 0; i < multiNames.length; i++) {
      const ep = await prisma.eventPlayer.create({ data: { eventId: multi.id, name: multiNames[i], userId: null } });
      multiPlayers.push(ep);
    }
    await prisma.eventCost.create({ data: { eventId: multi.id, totalAmount: 60, currency: "EUR" } });

    // Game 1 — 14 days ago, Ana is the payer; Diogo + Elena owe.
    const g1 = await prisma.game.create({ data: { eventId: multi.id, dateTime: new Date(now - 14 * 86400_000), status: "played" } });
    for (let i = 0; i < multiPlayers.length; i++) {
      await prisma.gameParticipant.create({ data: { gameId: g1.id, eventPlayerId: multiPlayers[i].id, order: i } });
    }
    await prisma.game.update({ where: { id: g1.id }, data: { paymentMode: "tracked", payerEventPlayerId: multiPlayers[0].id } }); // Ana
    await syncGamePayments(g1.id, multi.id);
    await prisma.gamePayment.updateMany({ where: { gameId: g1.id, eventPlayerId: multiPlayers[1].id }, data: { status: "paid", paidAt: new Date(), markedBy: multiOwner.id } }); // Bruno
    await prisma.gamePayment.updateMany({ where: { gameId: g1.id, eventPlayerId: multiPlayers[2].id }, data: { status: "paid", paidAt: new Date(), markedBy: multiOwner.id } }); // Carla

    // Game 2 — 7 days ago, Bruno is the payer; Ana + Diogo + Filipe owe.
    const g2 = await prisma.game.create({ data: { eventId: multi.id, dateTime: new Date(now - 7 * 86400_000), status: "played" } });
    for (let i = 0; i < multiPlayers.length; i++) {
      await prisma.gameParticipant.create({ data: { gameId: g2.id, eventPlayerId: multiPlayers[i].id, order: i } });
    }
    await prisma.game.update({ where: { id: g2.id }, data: { paymentMode: "tracked", payerEventPlayerId: multiPlayers[1].id } }); // Bruno
    await syncGamePayments(g2.id, multi.id);
    await prisma.gamePayment.updateMany({ where: { gameId: g2.id, eventPlayerId: multiPlayers[2].id }, data: { status: "paid", paidAt: new Date(), markedBy: multiOwner.id } }); // Carla
    await prisma.gamePayment.updateMany({ where: { gameId: g2.id, eventPlayerId: multiPlayers[4].id }, data: { status: "paid", paidAt: new Date(), markedBy: multiOwner.id } }); // Elena

    await prisma.event.update({ where: { id: multi.id }, data: { currentGameId: g2.id } });

    console.log(`\n  ** MULTI-GAME SETTLEMENT DEMO (${multiOwner.id === realUser?.id ? "owned by jecabeda@gmail.com" : "owned by demo user"}):`);
    console.log(`     ${multi.id}  "${multi.title}"`);
    console.log(`       URL: /events/${multi.id}/payments`);
    console.log(`     Game 1 (14d ago) payer Ana — Diogo, Elena owe`);
    console.log(`     Game 2 (7d ago)  payer Bruno — Ana, Diogo, Filipe owe`);
    console.log(`     People: Ana owes game 2 (no netting vs. what she's owed); Diogo owes both`);
  }

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
