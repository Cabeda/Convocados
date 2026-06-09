import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET as getPostGameStatus } from "~/pages/api/events/[id]/post-game-status";
import { GET as getMvp } from "~/pages/api/events/[id]/history/[historyId]/mvp";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
}));

function ctx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", { method: "GET" });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.mvpVote.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("Regression: wrap-up must show completed game players, not next game players", () => {
  it("paymentsSnapshot shows OLD game players even when live payments exist for new game", async () => {
    // Scenario: recurring event reset happened.
    // Old game had players Alice+Bob, history entry has NO paymentsSnapshot
    // (payments were not set up before the reset).
    // New game has players Charlie+Diana with live payments.
    // The banner should NOT show Charlie+Diana.
    const event = await prisma.event.create({
      data: {
        title: "Weekly Futsal",
        location: "Pitch",
        dateTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // next game in future
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
        isRecurring: true,
      },
    });

    // History from old game — has teamsSnapshot but NO paymentsSnapshot
    // (cost was set up AFTER the reset)
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 2,
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "Alice", order: 0 }] },
          { team: "B", players: [{ name: "Bob", order: 0 }] },
        ]),
        // NO paymentsSnapshot — this is the key regression trigger
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // New game players registered
    await prisma.player.create({ data: { name: "Charlie", eventId: event.id, order: 0 } });
    await prisma.player.create({ data: { name: "Diana", eventId: event.id, order: 1 } });

    // Cost set up for new game with live payments for Charlie+Diana
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Charlie", amount: 25, status: "pending" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Diana", amount: 25, status: "pending" },
    });

    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();

    // The banner should NOT show Charlie+Diana (next game's players)
    // It should either show null (no past payment data) or the old game's players
    if (json.paymentsSnapshot !== null) {
      const names = json.paymentsSnapshot.map((p: any) => p.playerName);
      expect(names).not.toContain("Charlie");
      expect(names).not.toContain("Diana");
    }
  });

  it("MVP participants come from teamsSnapshot, not current event.players", async () => {
    // After reset: old game had Alice+Bob in teams, new game has Charlie+Diana registered
    // MVP voting should show Alice+Bob, not Charlie+Diana
    const event = await prisma.event.create({
      data: {
        title: "Weekly Futsal",
        location: "Pitch",
        dateTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
        isRecurring: true,
        mvpEnabled: true,
      },
    });

    const history = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 2,
        status: "played",
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "Alice", order: 0 }] },
          { team: "B", players: [{ name: "Bob", order: 0 }] },
        ]),
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // New game has different players registered
    await prisma.player.create({ data: { name: "Charlie", eventId: event.id, order: 0 } });
    await prisma.player.create({ data: { name: "Diana", eventId: event.id, order: 1 } });

    const res = await getMvp(ctx({ id: event.id, historyId: history.id }));
    const json = await res.json();

    // Participants should be from teamsSnapshot (Alice, Bob)
    const participantNames = json.participants.map((p: any) => p.name);
    expect(participantNames).toContain("Alice");
    expect(participantNames).toContain("Bob");
    expect(participantNames).not.toContain("Charlie");
    expect(participantNames).not.toContain("Diana");
  });

  it("post-game-status does not fall back to live payments when history has no paymentsSnapshot", async () => {
    // The completed game's history has no paymentsSnapshot.
    // After reset, event.dateTime moved forward. Live payments exist for the
    // NEW game's players. Banner must NOT show them.
    const event = await prisma.event.create({
      data: {
        title: "Weekly Futsal",
        location: "Pitch",
        dateTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // next game in future (post-reset)
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
        isRecurring: true,
      },
    });

    // History from old game (dateTime is older than event.dateTime → reset occurred)
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 2,
        scoreTwo: 1,
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "OldPlayer1", order: 0 }] },
          { team: "B", players: [{ name: "OldPlayer2", order: 0 }] },
        ]),
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Live payments exist for DIFFERENT players (the next game's players)
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 40, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "NewPlayer1", amount: 20, status: "pending" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "NewPlayer2", amount: 20, status: "pending" },
    });

    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();

    // Should NOT show NewPlayer1/NewPlayer2 in the banner payment list
    if (json.paymentsSnapshot !== null) {
      const names = json.paymentsSnapshot.map((p: any) => p.playerName);
      expect(names).not.toContain("NewPlayer1");
      expect(names).not.toContain("NewPlayer2");
    }
  });

  it("hasCost reflects past game state, not new game cost", async () => {
    // Old game had no cost set. New game has cost set.
    // Banner should show hasCost=false for the wrap-up.
    const event = await prisma.event.create({
      data: {
        title: "Weekly Futsal",
        location: "Pitch",
        dateTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
        isRecurring: true,
      },
    });

    // History from old game — no paymentsSnapshot (no cost was set for old game)
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 1,
        scoreTwo: 1,
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // New game has cost set
    await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 60, currency: "EUR" },
    });

    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();

    // Past game had no cost — hasCost should be false for the banner
    // (even though new game has cost set)
    expect(json.hasCost).toBe(false);
  });
});
