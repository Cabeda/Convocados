import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { computeHomeActions } from "~/lib/homeActions.server";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await prisma.mvpVote.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

async function seedUser(id = "u1", name = "Alice") {
  return prisma.user.create({ data: { id, name, email: `${id}@test.com`, emailVerified: true } });
}

async function seedEvent(opts: {
  ownerId?: string;
  title?: string;
  dateTime: Date;
  maxPlayers?: number;
  durationMinutes?: number;
  mvpEnabled?: boolean;
}) {
  return prisma.event.create({
    data: {
      title: opts.title ?? "Game",
      location: "Pitch",
      dateTime: opts.dateTime,
      maxPlayers: opts.maxPlayers ?? 10,
      durationMinutes: opts.durationMinutes ?? 60,
      isPublic: true,
      ownerId: opts.ownerId ?? null,
      ...(opts.mvpEnabled !== undefined ? { mvpEnabled: opts.mvpEnabled } : {}),
    },
  });
}

describe("computeHomeActions", () => {
  it("returns fill_spots for an owned game with open spots within 72h", async () => {
    const user = await seedUser();
    const event = await seedEvent({ ownerId: user.id, dateTime: new Date(Date.now() + 24 * HOUR) });
    await prisma.player.createMany({
      data: [0, 1, 2].map((order) => ({ eventId: event.id, name: `P${order}`, order })),
    });
    const actions = await computeHomeActions(user.id);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "fill_spots", eventId: event.id, spotsLeft: 7 });
  });

  it("does not return fill_spots outside the 72h window", async () => {
    const user = await seedUser();
    await seedEvent({ ownerId: user.id, dateTime: new Date(Date.now() + 5 * DAY) });
    expect(await computeHomeActions(user.id)).toEqual([]);
  });

  it("returns settle_score for an owned game that ended without a score", async () => {
    const user = await seedUser();
    const event = await seedEvent({ ownerId: user.id, dateTime: new Date(Date.now() - 2 * HOUR) });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 1 * HOUR),
        status: "played",
        teamOneName: "Reds",
        teamTwoName: "Blues",
        scoreOne: null,
        scoreTwo: null,
      },
    });
    const actions = await computeHomeActions(user.id);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "settle_score", eventId: event.id });
  });

  it("does not return settle_score once a score exists", async () => {
    const user = await seedUser();
    const event = await seedEvent({ ownerId: user.id, dateTime: new Date(Date.now() - 2 * HOUR) });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 1 * HOUR),
        status: "played",
        teamOneName: "Reds",
        teamTwoName: "Blues",
        scoreOne: 3,
        scoreTwo: 1,
      },
    });
    expect(await computeHomeActions(user.id)).toEqual([]);
  });

  it("returns pay_share with the outstanding amount", async () => {
    const user = await seedUser();
    const event = await seedEvent({ dateTime: new Date(Date.now() - DAY) });
    await prisma.eventCost.create({ data: { eventId: event.id, totalAmount: 30, currency: "EUR" } });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: user.id } });
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: new Date(Date.now() - DAY), status: "played" },
    });
    await prisma.gamePayment.create({
      data: { gameId: game.id, eventPlayerId: ep.id, playerName: "Alice", amount: 15, status: "pending" },
    });
    const actions = await computeHomeActions(user.id);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "pay_share", eventId: event.id, amount: 15, currency: "EUR" });
  });

  it("does not return pay_share once the share is paid", async () => {
    const user = await seedUser();
    const event = await seedEvent({ dateTime: new Date(Date.now() - DAY) });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: user.id } });
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: new Date(Date.now() - DAY), status: "played" },
    });
    await prisma.gamePayment.create({
      data: { gameId: game.id, eventPlayerId: ep.id, playerName: "Alice", amount: 15, status: "paid" },
    });
    expect(await computeHomeActions(user.id)).toEqual([]);
  });

  it("does not return pay_share for a future game", async () => {
    const user = await seedUser();
    const event = await seedEvent({ dateTime: new Date(Date.now() + 2 * DAY) });
    await prisma.eventCost.create({ data: { eventId: event.id, totalAmount: 30, currency: "EUR" } });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: user.id } });
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: new Date(Date.now() + 2 * DAY), status: "upcoming" },
    });
    await prisma.gamePayment.create({
      data: { gameId: game.id, eventPlayerId: ep.id, playerName: "Alice", amount: 15, status: "pending" },
    });
    expect(await computeHomeActions(user.id)).toEqual([]);
  });

  it("returns vote_mvp for a participant who hasn't voted, and clears after voting", async () => {
    const user = await seedUser();
    const event = await seedEvent({ dateTime: new Date(Date.now() - 2 * HOUR) });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: user.id } });
    const history = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 1 * HOUR),
        status: "played",
        teamOneName: "Reds",
        teamTwoName: "Blues",
        scoreOne: 2,
        scoreTwo: 2,
        teamsSnapshot: JSON.stringify([
          { team: "Reds", players: [{ name: "Alice", order: 0 }, { name: "Bob", order: 1 }] },
          { team: "Blues", players: [{ name: "Carol", order: 0 }] },
        ]),
      },
    });

    const before = await computeHomeActions(user.id);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ type: "vote_mvp", eventId: event.id });

    await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: `name:Alice`,
        voterName: "Alice",
        votedForPlayerId: "name:Bob",
        votedForName: "Bob",
      },
    });
    expect(await computeHomeActions(user.id)).toEqual([]);
  });

  it("caps at 3 and orders by deadline ascending", async () => {
    const user = await seedUser();
    for (const [i, hours] of [4, 1, 3, 2].entries()) {
      const event = await seedEvent({
        ownerId: user.id,
        title: `E${i}`,
        dateTime: new Date(Date.now() + hours * HOUR),
      });
      await prisma.player.create({ data: { eventId: event.id, name: "P0", order: 0 } });
    }
    const actions = await computeHomeActions(user.id);
    expect(actions).toHaveLength(3);
    const deadlines = actions.map((a) => new Date(a.deadline).getTime());
    expect(deadlines).toEqual([...deadlines].sort((a, b) => a - b));
    expect(actions.map((a) => a.eventTitle)).toEqual(["E1", "E3", "E2"]);
  });
});
