import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mergeUsers } from "~/lib/merge.server";
import { findSplitIdentities, collapseSplitIdentities, reconcilePaymentNames } from "~/lib/backfillMergedIdentity.server";

const testPrisma = new PrismaClient();

async function seedUser(name: string, email: string) {
  const id = `mpi-${Math.random().toString(36).slice(2, 10)}`;
  return testPrisma.user.create({ data: { id, name, email, emailVerified: true } });
}

async function seedEvent(id: string, ownerId: string, eloEnabled = false) {
  return testPrisma.event.create({
    data: { id, title: `Event ${id}`, dateTime: new Date(), sport: "football-5v5", location: "Pitch", ownerId, eloEnabled },
  });
}

async function cleanup() {
  await testPrisma.mvpVote.deleteMany();
  await testPrisma.gameHistory.deleteMany();
  await testPrisma.gamePayment.deleteMany();
  await testPrisma.gameParticipant.deleteMany();
  await testPrisma.rsvp.deleteMany();
  await testPrisma.eventPlayer.deleteMany();
  await testPrisma.teamMember.deleteMany();
  await testPrisma.teamResult.deleteMany();
  await testPrisma.game.deleteMany();
  await testPrisma.playerRating.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.seasonMembership.deleteMany();
  await testPrisma.season.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.user.deleteMany();
}

beforeEach(cleanup);

describe("mergeUsers collapses name-keyed player identity", () => {
  it("absorbs the absorbed player name into the survivor's per-event player", async () => {
    const survivor = await seedUser("Cabeda", "cabeda@proton.me");
    const absorbed = await seedUser("José Cabeda", "jose@gmail.com");
    const event = await seedEvent("ev-identity", survivor.id);

    const survivorEp = await testPrisma.eventPlayer.create({
      data: { eventId: event.id, name: "Cabeda", userId: survivor.id },
    });
    const absorbedEp = await testPrisma.eventPlayer.create({
      data: { eventId: event.id, name: "José Cabeda", userId: absorbed.id, gamesPlayed: 10 },
    });

    const game = await testPrisma.game.create({
      data: { eventId: event.id, dateTime: new Date(), status: "played" },
    });
    await testPrisma.gameParticipant.create({
      data: { gameId: game.id, eventPlayerId: absorbedEp.id, order: 0 },
    });

    const hist = await testPrisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(),
        status: "played",
        scoreOne: 3,
        scoreTwo: 1,
        teamOneName: "Reds",
        teamTwoName: "Blues",
        teamsSnapshot: JSON.stringify([
          { team: "Reds", players: [{ name: "José Cabeda", order: 0 }, { name: "Other", order: 1 }] },
          { team: "Blues", players: [{ name: "Another", order: 0 }] },
        ]),
        paymentsSnapshot: JSON.stringify([
          { playerName: "José Cabeda", amount: 5, status: "pending" },
          { playerName: "Other", amount: 5, status: "paid" },
        ]),
      },
    });
    await testPrisma.gamePayment.create({
      data: { gameId: game.id, eventPlayerId: absorbedEp.id, playerName: "José Cabeda", amount: 5, status: "pending" },
    });
    await testPrisma.mvpVote.create({
      data: {
        gameHistoryId: hist.id,
        voterPlayerId: absorbedEp.id,
        voterName: "José Cabeda",
        votedForPlayerId: survivorEp.id,
        votedForName: "Cabeda",
      },
    });

    // Legacy unlinked rows (ADR 0016 drift): same name, userId null.
    await testPrisma.playerRating.create({
      data: { eventId: event.id, name: "José Cabeda", rating: 983, gamesPlayed: 12 },
    });
    await testPrisma.playerRating.create({
      data: { eventId: event.id, name: "Cabeda", rating: 1011, gamesPlayed: 2 },
    });
    await testPrisma.player.create({
      data: { eventId: event.id, name: "José Cabeda", userId: absorbed.id },
    });

    const team = await testPrisma.teamResult.create({ data: { eventId: event.id, name: "Reds" } });
    await testPrisma.teamMember.create({ data: { teamResultId: team.id, name: "José Cabeda", order: 0 } });

    const result = await testPrisma.$transaction((tx) => mergeUsers(tx, survivor.id, absorbed.id));

    expect(result.mergedPlayerEvents).toContain(event.id);

    const eps = await testPrisma.eventPlayer.findMany({ where: { eventId: event.id } });
    expect(eps.map((e) => e.name)).toEqual(["Cabeda"]);
    expect(eps[0].userId).toBe(survivor.id);

    expect(
      await testPrisma.playerRating.findFirst({ where: { eventId: event.id, name: "José Cabeda" } }),
    ).toBeNull();
    expect(
      await testPrisma.player.findFirst({ where: { eventId: event.id, name: "José Cabeda" } }),
    ).toBeNull();

    const h = await testPrisma.gameHistory.findUnique({ where: { id: hist.id } });
    expect(h!.teamsSnapshot).toContain("Cabeda");
    expect(h!.teamsSnapshot).not.toContain("José Cabeda");
    expect(h!.paymentsSnapshot).toContain("Cabeda");
    expect(h!.paymentsSnapshot).not.toContain("José Cabeda");

    const pays = await testPrisma.gamePayment.findMany();
    expect(pays.map((p) => p.playerName)).toEqual(["Cabeda"]);

    const vote = await testPrisma.mvpVote.findFirst();
    expect(vote!.voterName).toBe("Cabeda");

    const parts = await testPrisma.gameParticipant.findMany();
    expect(parts).toHaveLength(1);
    expect(parts[0].eventPlayerId).toBe(eps[0].id);

    const members = await testPrisma.teamMember.findMany();
    expect(members.map((m) => m.name)).toEqual(["Cabeda"]);
  });

  it("renames to the survivor account name when the survivor has no player row in the event", async () => {
    const survivor = await seedUser("Cabeda", "cabeda@proton.me");
    const absorbed = await seedUser("José Cabeda", "jose@gmail.com");
    const event = await seedEvent("ev-new", survivor.id);

    await testPrisma.eventPlayer.create({
      data: { eventId: event.id, name: "José Cabeda", userId: absorbed.id, gamesPlayed: 5 },
    });
    await testPrisma.playerRating.create({
      data: { eventId: event.id, name: "José Cabeda", rating: 950, gamesPlayed: 5 },
    });

    await testPrisma.$transaction((tx) => mergeUsers(tx, survivor.id, absorbed.id));

    const eps = await testPrisma.eventPlayer.findMany({ where: { eventId: event.id } });
    expect(eps.map((e) => e.name)).toEqual(["Cabeda"]);
    expect(eps[0].userId).toBe(survivor.id);

    const rating = await testPrisma.playerRating.findFirst({ where: { eventId: event.id } });
    expect(rating!.name).toBe("Cabeda");
    expect(rating!.userId).toBe(survivor.id);
  });

  it("leaves events the absorbed user never played untouched", async () => {
    const survivor = await seedUser("Cabeda", "cabeda@proton.me");
    const absorbed = await seedUser("José Cabeda", "jose@gmail.com");
    const event = await seedEvent("ev-untouched", survivor.id);
    await testPrisma.eventPlayer.create({ data: { eventId: event.id, name: "Someone", userId: null } });

    const result = await testPrisma.$transaction((tx) => mergeUsers(tx, survivor.id, absorbed.id));

    expect(result.mergedPlayerEvents).not.toContain(event.id);
    const eps = await testPrisma.eventPlayer.findMany({ where: { eventId: event.id } });
    expect(eps.map((e) => e.name)).toEqual(["Someone"]);
  });
});

describe("collapseSplitIdentities (backfill for already-merged accounts)", () => {
  it("collapses multiple name-keyed rows for one user into the account name", async () => {
    const user = await seedUser("Cabeda", "cabeda@proton.me");
    const event = await seedEvent("ev-backfill", user.id);

    await testPrisma.eventPlayer.create({ data: { eventId: event.id, name: "Cabeda", userId: user.id, gamesPlayed: 0 } });
    await testPrisma.eventPlayer.create({ data: { eventId: event.id, name: "José Cabeda", userId: user.id, gamesPlayed: 10 } });
    await testPrisma.playerRating.create({ data: { eventId: event.id, name: "José Cabeda", rating: 990, gamesPlayed: 10 } });

    const found = await findSplitIdentities(testPrisma);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ eventId: event.id, targetName: "Cabeda" });

    const n = await collapseSplitIdentities(testPrisma, found);
    expect(n).toBe(1);

    const eps = await testPrisma.eventPlayer.findMany({ where: { eventId: event.id } });
    expect(eps.map((e) => e.name)).toEqual(["Cabeda"]);
    expect(eps[0].userId).toBe(user.id);
  });

  it("ignores events where the user has a single player name", async () => {
    const user = await seedUser("Solo", "solo@proton.me");
    const event = await seedEvent("ev-solo", user.id);
    await testPrisma.eventPlayer.create({ data: { eventId: event.id, name: "Solo", userId: user.id } });

    const found = await findSplitIdentities(testPrisma);
    expect(found).toHaveLength(0);
  });

  it("reconciles denormalized payment names that drifted from the linked player", async () => {
    const user = await seedUser("Cabeda", "cabeda@proton.me");
    const event = await seedEvent("ev-reconcile", user.id);
    const ep = await testPrisma.eventPlayer.create({ data: { eventId: event.id, name: "Cabeda", userId: user.id } });
    const game = await testPrisma.game.create({ data: { eventId: event.id, dateTime: new Date(), status: "played" } });
    await testPrisma.gamePayment.create({
      data: { gameId: game.id, eventPlayerId: ep.id, playerName: "José Cabeda", amount: 5, status: "pending" },
    });
    const hist = await testPrisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(),
        status: "played",
        teamOneName: "Reds",
        teamTwoName: "Blues",
        paymentsSnapshot: JSON.stringify([{ playerName: "José Cabeda", amount: 5, status: "pending" }]),
      },
    });

    const corrected = await reconcilePaymentNames(testPrisma);
    expect(corrected).toBe(1);

    const pays = await testPrisma.gamePayment.findMany();
    expect(pays.map((p) => p.playerName)).toEqual(["Cabeda"]);
    const h = await testPrisma.gameHistory.findUnique({ where: { id: hist.id } });
    expect(h!.paymentsSnapshot).toContain("Cabeda");
    expect(h!.paymentsSnapshot).not.toContain("José Cabeda");
  });
});
