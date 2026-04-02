import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET as getPostGameStatus } from "~/pages/api/events/[id]/post-game-status";

function ctx(params: Record<string, string>, queryString?: string) {
  const urlStr = `http://localhost/api/test${queryString ? `?${queryString}` : ""}`;
  const request = new Request(urlStr, { method: "GET" });
  return { request, params, url: new URL(urlStr) } as any;
}

beforeEach(async () => {
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

describe("GET /api/events/:id/post-game-status", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await getPostGameStatus(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("returns gameEnded=false for future event", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Future Game",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.gameEnded).toBe(false);
  });

  it("returns gameEnded=true for past event", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.gameEnded).toBe(true);
  });

  it("returns hasScore=false when no history exists", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.hasScore).toBe(false);
  });

  it("returns hasScore=true when history has score", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 2,
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.hasScore).toBe(true);
  });

  it("returns hasScore=false when history exists but no score set", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        teamOneName: "A",
        teamTwoName: "B",
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.hasScore).toBe(false);
  });

  it("returns hasScore=false when only older history has score but latest does not", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Recurring Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    // Old game with score
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 2,
        scoreTwo: 1,
        editableUntil: new Date(Date.now() - 1000),
      },
    });
    // Latest game without score
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.hasScore).toBe(false);
  });

  it("returns allPaid=true when no cost is set", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.allPaid).toBe(true);
  });

  it("returns allPaid=false when there are pending payments", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Alice", amount: 25, status: "pending" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Bob", amount: 25, status: "paid" },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.allPaid).toBe(false);
  });

  it("returns allPaid=true when all payments are paid or exempt", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Alice", amount: 25, status: "paid" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Bob", amount: 25, status: "exempt" },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.allPaid).toBe(true);
  });

  it("returns allComplete=true only when both score and payments are done", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 1,
        scoreTwo: 1,
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    // No cost set → allPaid=true
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.hasScore).toBe(true);
    expect(json.allPaid).toBe(true);
    expect(json.allComplete).toBe(true);
  });

  it("returns allComplete=false when score is missing", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.allComplete).toBe(false);
  });

  it("returns hasCost=false when no cost is set", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.hasCost).toBe(false);
  });

  it("returns hasCost=true when cost is set", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.hasCost).toBe(true);
  });

  it("returns isParticipant=false for anonymous users", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.isParticipant).toBe(false);
  });

  it("returns allPaid=false when live payments are empty but history snapshot has unpaid items", async () => {
    // Simulates: recurrence reset cleared live payments, but previous game has unpaid snapshot
    const event = await prisma.event.create({
      data: {
        title: "Recurring Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    // EventCost exists but no live payments (cleared by reset)
    await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    // History entry with unpaid snapshot
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 2,
        paymentsSnapshot: JSON.stringify([
          { playerName: "Alice", amount: 25, status: "paid", method: null },
          { playerName: "Bob", amount: 25, status: "pending", method: null },
        ]),
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.allPaid).toBe(false);
    expect(json.hasCost).toBe(true);
    expect(json.allComplete).toBe(false);
  });

  it("returns allPaid=true when history snapshot has all paid/exempt", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Recurring Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 2,
        paymentsSnapshot: JSON.stringify([
          { playerName: "Alice", amount: 25, status: "paid", method: null },
          { playerName: "Bob", amount: 25, status: "exempt", method: null },
        ]),
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.allPaid).toBe(true);
    expect(json.allComplete).toBe(true);
  });

  it("returns latestHistoryId and paymentsSnapshot for banner rendering", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "USD" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Alice", amount: 25, status: "pending" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Bob", amount: 25, status: "paid" },
    });
    const history = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 2,
        paymentsSnapshot: JSON.stringify([
          { playerName: "Alice", amount: 25, status: "pending", method: null },
          { playerName: "Bob", amount: 25, status: "paid", method: null },
        ]),
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.latestHistoryId).toBe(history.id);
    expect(json.paymentsSnapshot).toHaveLength(2);
    expect(json.paymentsSnapshot[0].playerName).toBe("Alice");
    expect(json.paymentsSnapshot[0].status).toBe("pending");
    expect(json.paymentsSnapshot[1].status).toBe("paid");
    expect(json.costCurrency).toBe("USD");
    expect(json.costAmount).toBe(50);
  });

  it("returns paymentsSnapshot from live payments when no history snapshot exists", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Alice", amount: 25, status: "pending" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Bob", amount: 25, status: "paid" },
    });
    // History exists but no paymentsSnapshot
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 2,
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    // Should derive from live payments
    expect(json.paymentsSnapshot).toHaveLength(2);
    expect(json.costCurrency).toBe("EUR");
  });

  it("returns null paymentsSnapshot when no cost and no history payments", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Past Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.paymentsSnapshot).toBeNull();
    expect(json.latestHistoryId).toBeNull();
    expect(json.costCurrency).toBeNull();
    expect(json.costAmount).toBeNull();
  });

  // ─── Decoupled payment logic: banner vs upcoming game ─────────────────

  it("banner reads from history snapshot even when live payments exist (post-reset)", async () => {
    // After recurrence reset: history has snapshot with 1 unpaid,
    // but live payments are for the NEW game (all paid by new players).
    // Banner should show allPaid=false (from snapshot), not true (from live).
    const event = await prisma.event.create({
      data: {
        title: "Recurring Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    // Live payments for the UPCOMING game — all paid (someone paid in advance)
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Charlie", amount: 25, status: "paid" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Diana", amount: 25, status: "paid" },
    });
    // History snapshot for the PAST game — Bob hasn't paid
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 2,
        paymentsSnapshot: JSON.stringify([
          { playerName: "Alice", amount: 25, status: "paid", method: null },
          { playerName: "Bob", amount: 25, status: "pending", method: null },
        ]),
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    // Banner should read from snapshot (past game), NOT from live payments
    expect(json.allPaid).toBe(false);
    expect(json.paymentsSnapshot).toHaveLength(2);
    expect(json.paymentsSnapshot[0].playerName).toBe("Alice");
    expect(json.paymentsSnapshot[1].playerName).toBe("Bob");
    expect(json.paymentsSnapshot[1].status).toBe("pending");
  });

  it("toggling a live payment does NOT affect banner when history snapshot exists", async () => {
    // Simulates: post-reset, new player marks themselves as paid for upcoming game.
    // Banner should still show past game as unpaid.
    const event = await prisma.event.create({
      data: {
        title: "Recurring Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    // Live: one pending payment for upcoming game
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "NewPlayer", amount: 50, status: "pending" },
    });
    // History: past game fully paid
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 1,
        scoreTwo: 1,
        paymentsSnapshot: JSON.stringify([
          { playerName: "Alice", amount: 25, status: "paid", method: null },
          { playerName: "Bob", amount: 25, status: "paid", method: null },
        ]),
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    // Banner should read from snapshot — past game is fully paid
    expect(json.allPaid).toBe(true);
    expect(json.allComplete).toBe(true);
    // Even though live payment is pending, banner doesn't care
  });

  it("advance payment is captured in snapshot during recurrence reset", async () => {
    // Player pays before game ends. After reset, the snapshot should reflect "paid".
    const event = await prisma.event.create({
      data: {
        title: "Recurring Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    // Snapshot captures the advance payment as "paid"
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 2,
        scoreTwo: 1,
        paymentsSnapshot: JSON.stringify([
          { playerName: "Alice", amount: 25, status: "paid", method: null },
          { playerName: "Bob", amount: 25, status: "paid", method: null },
        ]),
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.allPaid).toBe(true);
    expect(json.allComplete).toBe(true);
    expect(json.paymentsSnapshot[0].status).toBe("paid");
    expect(json.paymentsSnapshot[1].status).toBe("paid");
  });

  it("pre-reset: uses live payments when no history snapshot exists", async () => {
    // Game ended but hasn't reset yet. No history entry.
    // Live payments are the past game's payments.
    const event = await prisma.event.create({
      data: {
        title: "One-off Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
      },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Alice", amount: 25, status: "paid" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Bob", amount: 25, status: "pending" },
    });
    // No history entry at all
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.allPaid).toBe(false);
    expect(json.paymentsSnapshot).toHaveLength(2);
    expect(json.paymentsSnapshot[0].status).toBe("paid");
    expect(json.paymentsSnapshot[1].status).toBe("pending");
  });

  it("shows banner when game has reset but history snapshot has unpaid items", async () => {
    // After recurrence reset: event.dateTime is in the future (next game),
    // but the latest history entry has unpaid payments.
    // The banner should still show because the past game isn't settled.
    const event = await prisma.event.create({
      data: {
        title: "Weekly Futsal",
        location: "Pitch",
        // Next game is in the future
        dateTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        durationMinutes: 60,
        isRecurring: true,
      },
    });
    // History from the past game with unpaid snapshot
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 2,
        paymentsSnapshot: JSON.stringify([
          { playerName: "Alice", amount: 25, status: "paid", method: null },
          { playerName: "Bob", amount: 25, status: "pending", method: null },
        ]),
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    // gameEnded is false (next game is in the future), but banner should
    // still indicate there are unsettled payments from the past game
    expect(json.gameEnded).toBe(false);
    expect(json.hasPendingPastPayments).toBe(true);
    expect(json.allPaid).toBe(false);
    expect(json.paymentsSnapshot).toHaveLength(2);
    expect(json.latestHistoryId).toBeTruthy();
  });

  it("does not show hasPendingPastPayments when history is fully paid", async () => {
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
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 2,
        paymentsSnapshot: JSON.stringify([
          { playerName: "Alice", amount: 25, status: "paid", method: null },
          { playerName: "Bob", amount: 25, status: "paid", method: null },
        ]),
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await getPostGameStatus(ctx({ id: event.id }));
    const json = await res.json();
    expect(json.gameEnded).toBe(false);
    expect(json.hasPendingPastPayments).toBe(false);
  });
});
