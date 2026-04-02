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
});
