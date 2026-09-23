import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { backfillUnifiedModel } from "~/lib/backfillUnified.server";

const DATE = new Date("2025-03-01T18:00:00.000Z");

async function seedEvent() {
  return prisma.event.create({
    data: {
      title: "Unified Backfill",
      location: "Pitch",
      dateTime: DATE,
      maxPlayers: 10,
      teamOneName: "A",
      teamTwoName: "B",
    },
  });
}

beforeEach(async () => {
  await prisma.mvpVote.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("backfillUnifiedModel — historical GameHistory", () => {
  const teamsSnapshot = JSON.stringify([
    { team: "A", formation: "4-4-2", players: [
      { name: "Rui", order: 0, slot: 1 },
      { name: "Tomas", order: 1, slot: 2 },
    ] },
    { team: "B", formation: "4-3-3", players: [
      { name: "Sofia", order: 0, slot: 1 },
    ] },
  ]);
  const paymentsSnapshot = JSON.stringify([
    { playerName: "Rui", amount: 5, status: "paid", method: "mbway" },
    { playerName: "Tomas", amount: 5, status: "pending" },
  ]);

  it("materialises Game, participants, payments and links MVP votes", async () => {
    const event = await seedEvent();
    const history = await prisma.gameHistory.create({
      data: {
        eventId: event.id, dateTime: DATE, status: "played", source: "historical",
        teamOneName: "A", teamTwoName: "B", scoreOne: 6, scoreTwo: 3,
        teamsSnapshot, paymentsSnapshot,
      },
    });
    const vote = await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: "p1", voterName: "Rui",
        votedForPlayerId: "p2", votedForName: "Sofia",
      },
    });

    const result = await backfillUnifiedModel({ eventId: event.id });

    expect(result.historiesScanned).toBe(1);
    expect(result.gamesCreated).toBe(1);
    expect(result.participantsUpserted).toBe(3);
    expect(result.paymentsCreated).toBe(2);
    expect(result.votesLinked).toBe(1);

    const game = await prisma.game.findFirstOrThrow({ where: { eventId: event.id } });
    expect(game.source).toBe("historical");
    expect(game.status).toBe("played");
    expect(game.scoreOne).toBe(6);
    expect(game.teamOneFormation).toBe("4-4-2");
    expect(game.teamTwoFormation).toBe("4-3-3");

    const rui = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Rui" } });
    const participant = await prisma.gameParticipant.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: rui.id } },
    });
    expect(participant.team).toBe("A");
    expect(participant.slot).toBe(1);

    const payment = await prisma.gamePayment.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: rui.id } },
    });
    expect(payment.status).toBe("paid");
    expect(payment.method).toBe("mbway");
    expect(payment.amount).toBe(5);

    const linkedVote = await prisma.mvpVote.findUniqueOrThrow({ where: { id: vote.id } });
    expect(linkedVote.gameId).toBe(game.id);

    // GameHistory remains the authoritative legacy record until contract phase.
    expect(await prisma.gameHistory.count({ where: { id: history.id } })).toBe(1);
  });

  it("is idempotent — a second run creates nothing and duplicates nothing", async () => {
    const event = await seedEvent();
    await prisma.gameHistory.create({
      data: {
        eventId: event.id, dateTime: DATE, status: "played", source: "historical",
        teamOneName: "A", teamTwoName: "B", scoreOne: 6, scoreTwo: 3,
        teamsSnapshot, paymentsSnapshot,
      },
    });

    await backfillUnifiedModel({ eventId: event.id });
    const second = await backfillUnifiedModel({ eventId: event.id });

    expect(second.gamesCreated).toBe(0);
    expect(second.gamesReused).toBe(1);
    expect(second.paymentsCreated).toBe(0);
    expect(second.paymentsSkipped).toBe(2);
    expect(second.votesLinked).toBe(0);
    expect(await prisma.game.count({ where: { eventId: event.id } })).toBe(1);
    expect(await prisma.gamePayment.count()).toBe(2);
  });
});

describe("backfillUnifiedModel — never clobbers live settlement", () => {
  it("reuses an existing played Game and keeps its GamePayment rows", async () => {
    const event = await seedEvent();
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: DATE, status: "played", teamOneName: "A", teamTwoName: "B" },
    });
    const rui = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Rui" } });
    await prisma.gamePayment.create({
      data: { gameId: game.id, eventPlayerId: rui.id, playerName: "Rui", amount: 5, status: "paid" },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id, dateTime: DATE, status: "played", source: "live",
        teamOneName: "A", teamTwoName: "B", scoreOne: 1, scoreTwo: 0,
        paymentsSnapshot: JSON.stringify([{ playerName: "Rui", amount: 5, status: "pending" }]),
      },
    });

    const result = await backfillUnifiedModel({ eventId: event.id });

    expect(result.gamesCreated).toBe(0);
    expect(result.gamesReused).toBe(1);
    expect(result.paymentsCreated).toBe(0);
    expect(result.paymentsSkipped).toBe(1);
    expect(await prisma.game.count({ where: { eventId: event.id } })).toBe(1);

    const payment = await prisma.gamePayment.findUniqueOrThrow({
      where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: rui.id } },
    });
    expect(payment.status).toBe("paid");
  });
});

describe("backfillUnifiedModel — edge cases", () => {
  it("maps a cancelled history to a cancelled Game with no roster", async () => {
    const event = await seedEvent();
    await prisma.gameHistory.create({
      data: {
        eventId: event.id, dateTime: DATE, status: "cancelled", source: "live",
        teamOneName: "A", teamTwoName: "B",
      },
    });

    await backfillUnifiedModel({ eventId: event.id });

    const game = await prisma.game.findFirstOrThrow({ where: { eventId: event.id } });
    expect(game.status).toBe("cancelled");
    expect(await prisma.gameParticipant.count({ where: { gameId: game.id } })).toBe(0);
  });

  it("skips payments for an untracked game", async () => {
    const event = await seedEvent();
    const game = await prisma.game.create({
      data: {
        eventId: event.id, dateTime: DATE, status: "played",
        teamOneName: "A", teamTwoName: "B", paymentMode: "untracked",
      },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id, dateTime: DATE, status: "played", source: "live",
        teamOneName: "A", teamTwoName: "B",
        paymentsSnapshot: JSON.stringify([{ playerName: "Rui", amount: 5, status: "pending" }]),
      },
    });

    const result = await backfillUnifiedModel({ eventId: event.id });

    expect(result.paymentsCreated).toBe(0);
    expect(result.paymentsSkipped).toBe(0);
    expect(await prisma.gamePayment.count({ where: { gameId: game.id } })).toBe(0);
  });

  it("tolerates malformed snapshots without throwing", async () => {
    const event = await seedEvent();
    await prisma.gameHistory.create({
      data: {
        eventId: event.id, dateTime: DATE, status: "played", source: "historical",
        teamOneName: "A", teamTwoName: "B",
        teamsSnapshot: "{not valid json",
        paymentsSnapshot: "[also broken",
      },
    });

    const result = await backfillUnifiedModel({ eventId: event.id });

    expect(result.gamesCreated).toBe(1);
    expect(result.participantsUpserted).toBe(0);
    expect(result.paymentsCreated).toBe(0);
    const game = await prisma.game.findFirstOrThrow({ where: { eventId: event.id } });
    expect(game.teamOneFormation).toBeNull();
  });
});
