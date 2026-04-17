import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Import route handlers
import { PUT as setCost, GET as getCost, DELETE as deleteCost } from "~/pages/api/events/[id]/cost";
import { GET as getPayments, PUT as updatePayment } from "~/pages/api/events/[id]/payments";
import { POST as addPlayer, DELETE as removePlayer } from "~/pages/api/events/[id]/players";
import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { PUT as setOverride, DELETE as clearOverride } from "~/pages/api/events/[id]/cost/override";

function ctx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? "PUT" : "GET",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

function postCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

function deleteCtx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

async function seedEvent(playerNames: string[] = []) {
  const event = await prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
    },
  });
  for (let i = 0; i < playerNames.length; i++) {
    await prisma.player.create({
      data: { name: playerNames[i], eventId: event.id, order: i },
    });
  }
  return event.id;
}

async function seedOwnedEvent(playerNames: string[] = []) {
  const owner = await prisma.user.upsert({
    where: { id: "owner-payments-test" },
    update: {},
    create: { id: "owner-payments-test", name: "Owner", email: "owner-pay@test.com", createdAt: new Date(), updatedAt: new Date() },
  });
  const event = await prisma.event.create({
    data: {
      title: "Owned Event",
      location: "Pitch B",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: owner.id,
    },
  });
  for (let i = 0; i < playerNames.length; i++) {
    await prisma.player.create({
      data: { name: playerNames[i], eventId: event.id, order: i },
    });
  }
  return event.id;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
});

// ─── PUT /api/events/[id]/cost ───────────────────────────────────────────────

describe("PUT /api/events/[id]/cost", () => {
  it("creates event cost and auto-generates player payments", async () => {
    const eventId = await seedEvent(["Alice", "Bob", "Charlie"]);
    const res = await setCost(ctx({ id: eventId }, { totalAmount: 60, currency: "EUR" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalAmount).toBe(60);
    expect(body.currency).toBe("EUR");
    expect(body.payments).toHaveLength(3);
    expect(body.payments[0].amount).toBeCloseTo(20);
    expect(body.payments[0].status).toBe("pending");
  });

  it("updates existing cost and recalculates shares", async () => {
    const eventId = await seedEvent(["Alice", "Bob"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 40 }));
    const res = await setCost(ctx({ id: eventId }, { totalAmount: 60 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalAmount).toBe(60);
    expect(body.payments).toHaveLength(2);
    expect(body.payments[0].amount).toBeCloseTo(30);
  });

  it("saves payment details text", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentDetails: "Revolut @jose / MB Way 912345678",
    }));
    const body = await res.json();
    expect(body.paymentDetails).toBe("Revolut @jose / MB Way 912345678");
  });

  it("returns 404 for non-existent event", async () => {
    const res = await setCost(ctx({ id: "nonexistent" }, { totalAmount: 50 }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid amount", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await setCost(ctx({ id: eventId }, { totalAmount: -10 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for zero amount", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await setCost(ctx({ id: eventId }, { totalAmount: 0 }));
    expect(res.status).toBe(400);
  });

  it("preserves existing payment statuses when updating cost", async () => {
    const eventId = await seedEvent(["Alice", "Bob"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 40 }));

    // Mark Alice as paid
    await updatePayment(ctx({ id: eventId }, { playerName: "Alice", status: "paid" }));

    // Update cost
    const res = await setCost(ctx({ id: eventId }, { totalAmount: 60 }));
    const body = await res.json();
    const alice = body.payments.find((p: any) => p.playerName === "Alice");
    expect(alice.status).toBe("paid");
    expect(alice.amount).toBeCloseTo(30);
  });

  it("only creates payments for active players (not bench)", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Small Game",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        maxPlayers: 2,
      },
    });
    for (let i = 0; i < 3; i++) {
      await prisma.player.create({
        data: { name: `Player ${i}`, eventId: event.id, order: i },
      });
    }
    const res = await setCost(ctx({ id: event.id }, { totalAmount: 30 }));
    const body = await res.json();
    // Only 2 active players, not the bench player
    expect(body.payments).toHaveLength(2);
    expect(body.payments[0].amount).toBeCloseTo(15);
  });
});

// ─── GET /api/events/[id]/cost ───────────────────────────────────────────────

describe("GET /api/events/[id]/cost", () => {
  it("returns null when no cost is set", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await getCost(ctx({ id: eventId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it("returns cost with payments and summary", async () => {
    const eventId = await seedEvent(["Alice", "Bob"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 40 }));
    await updatePayment(ctx({ id: eventId }, { playerName: "Alice", status: "paid" }));

    const res = await getCost(ctx({ id: eventId }));
    const body = await res.json();
    expect(body.totalAmount).toBe(40);
    expect(body.payments).toHaveLength(2);
    expect(body.summary.paidCount).toBe(1);
    expect(body.summary.totalCount).toBe(2);
    expect(body.summary.paidAmount).toBeCloseTo(20);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await getCost(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/events/[id]/cost ────────────────────────────────────────────

describe("DELETE /api/events/[id]/cost", () => {
  it("deletes cost and all payments", async () => {
    const eventId = await seedEvent(["Alice", "Bob"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 40 }));

    const res = await deleteCost(deleteCtx({ id: eventId }));
    expect(res.status).toBe(200);

    const getRes = await getCost(ctx({ id: eventId }));
    const body = await getRes.json();
    expect(body).toBeNull();
  });

  it("returns 404 when no cost exists", async () => {
    const eventId = await seedEvent([]);
    const res = await deleteCost(deleteCtx({ id: eventId }));
    expect(res.status).toBe(404);
  });
});

// ─── PUT /api/events/[id]/payments ───────────────────────────────────────────

describe("PUT /api/events/[id]/payments", () => {
  it("marks a player as paid", async () => {
    const eventId = await seedEvent(["Alice", "Bob"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 40 }));

    const res = await updatePayment(ctx({ id: eventId }, {
      playerName: "Alice",
      status: "paid",
      method: "revolut",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("paid");
    expect(body.method).toBe("revolut");
    expect(body.paidAt).toBeTruthy();
  });

  it("marks a player as paid and toggles back to pending", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 50 }));
    await updatePayment(ctx({ id: eventId }, { playerName: "Alice", status: "paid" }));

    const res = await updatePayment(ctx({ id: eventId }, {
      playerName: "Alice",
      status: "pending",
    }));
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(body.paidAt).toBeNull();
  });

  it("returns 404 when no cost exists", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await updatePayment(ctx({ id: eventId }, {
      playerName: "Alice",
      status: "paid",
    }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown player", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 50 }));

    const res = await updatePayment(ctx({ id: eventId }, {
      playerName: "Unknown",
      status: "paid",
    }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid status", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 50 }));

    const res = await updatePayment(ctx({ id: eventId }, {
      playerName: "Alice",
      status: "invalid",
    }));
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/events/[id]/payments ───────────────────────────────────────────

describe("GET /api/events/[id]/payments", () => {
  it("returns payments list with summary", async () => {
    const eventId = await seedEvent(["Alice", "Bob", "Charlie"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 60 }));
    await updatePayment(ctx({ id: eventId }, { playerName: "Alice", status: "paid" }));

    const res = await getPayments(ctx({ id: eventId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payments).toHaveLength(3);
    expect(body.summary.paidCount).toBe(1);
    expect(body.summary.pendingCount).toBe(2);
    expect(body.summary.paidAmount).toBeCloseTo(20);
  });

  it("returns empty when no cost set", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await getPayments(ctx({ id: eventId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payments).toHaveLength(0);
    expect(body.summary.totalCount).toBe(0);
  });
});

// ─── Auto-recalculate shares on player changes ──────────────────────────────

describe("Auto-recalculate payment shares on player changes", () => {
  it("recalculates shares when a player is added", async () => {
    const eventId = await seedEvent(["Alice", "Bob"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 60 }));

    // 60 / 2 = 30 each
    let costRes = await getCost(ctx({ id: eventId }));
    let cost = await costRes.json();
    expect(cost.payments).toHaveLength(2);
    expect(cost.payments[0].amount).toBeCloseTo(30);

    // Add a third player
    await addPlayer(postCtx({ id: eventId }, { name: "Charlie" }));

    // 60 / 3 = 20 each
    costRes = await getCost(ctx({ id: eventId }));
    cost = await costRes.json();
    expect(cost.payments).toHaveLength(3);
    expect(cost.payments[0].amount).toBeCloseTo(20);
    expect(cost.payments.find((p: any) => p.playerName === "Charlie")).toBeTruthy();
  });

  it("recalculates shares when a player is removed", async () => {
    const eventId = await seedEvent(["Alice", "Bob", "Charlie"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 60 }));

    // 60 / 3 = 20 each
    let costRes = await getCost(ctx({ id: eventId }));
    let cost = await costRes.json();
    expect(cost.payments).toHaveLength(3);
    expect(cost.payments[0].amount).toBeCloseTo(20);

    // Remove Charlie
    const players = await prisma.player.findMany({ where: { eventId } });
    const charlie = players.find((p) => p.name === "Charlie")!;
    await removePlayer(deleteCtx({ id: eventId }, { playerId: charlie.id }));

    // 60 / 2 = 30 each
    costRes = await getCost(ctx({ id: eventId }));
    cost = await costRes.json();
    expect(cost.payments).toHaveLength(2);
    expect(cost.payments[0].amount).toBeCloseTo(30);
    expect(cost.payments.find((p: any) => p.playerName === "Charlie")).toBeFalsy();
  });

  it("preserves payment statuses when recalculating after player added", async () => {
    const eventId = await seedEvent(["Alice", "Bob"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 60 }));
    await updatePayment(ctx({ id: eventId }, { playerName: "Alice", status: "paid" }));

    // Add Charlie
    await addPlayer(postCtx({ id: eventId }, { name: "Charlie" }));

    const costRes = await getCost(ctx({ id: eventId }));
    const cost = await costRes.json();
    const alice = cost.payments.find((p: any) => p.playerName === "Alice");
    expect(alice.status).toBe("paid");
    expect(alice.amount).toBeCloseTo(20);
  });

  it("does nothing when no cost is set and player is added", async () => {
    const eventId = await seedEvent(["Alice"]);

    // No cost set — adding a player should not fail
    const res = await addPlayer(postCtx({ id: eventId }, { name: "Bob" }));
    expect(res.status).toBe(200);

    const costRes = await getCost(ctx({ id: eventId }));
    const cost = await costRes.json();
    expect(cost).toBeNull();
  });

  it("does not add bench player to payments", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Small Game",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        maxPlayers: 2,
      },
    });
    for (let i = 0; i < 2; i++) {
      await prisma.player.create({
        data: { name: `Player${i}`, eventId: event.id, order: i },
      });
    }
    await setCost(ctx({ id: event.id }, { totalAmount: 40 }));

    // Add a 3rd player — goes to bench
    await addPlayer(postCtx({ id: event.id }, { name: "BenchPlayer" }));

    const costRes = await getCost(ctx({ id: event.id }));
    const cost = await costRes.json();
    // Still only 2 active players
    expect(cost.payments).toHaveLength(2);
    expect(cost.payments[0].amount).toBeCloseTo(20);
    expect(cost.payments.find((p: any) => p.playerName === "BenchPlayer")).toBeFalsy();
  });

  it("promotes bench player to payments when active player is removed", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Small Game",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        maxPlayers: 2,
      },
    });
    for (const name of ["Alice", "Bob", "Charlie"]) {
      await prisma.player.create({
        data: { name, eventId: event.id, order: ["Alice", "Bob", "Charlie"].indexOf(name) },
      });
    }
    await setCost(ctx({ id: event.id }, { totalAmount: 40 }));

    // Charlie is on bench, payments should be Alice + Bob
    let costRes = await getCost(ctx({ id: event.id }));
    let cost = await costRes.json();
    expect(cost.payments).toHaveLength(2);

    // Remove Alice — Charlie gets promoted
    const alice = await prisma.player.findFirst({ where: { eventId: event.id, name: "Alice" } });
    await removePlayer(deleteCtx({ id: event.id }, { playerId: alice!.id }));

    costRes = await getCost(ctx({ id: event.id }));
    cost = await costRes.json();
    expect(cost.payments).toHaveLength(2);
    expect(cost.payments.find((p: any) => p.playerName === "Alice")).toBeFalsy();
    expect(cost.payments.find((p: any) => p.playerName === "Charlie")).toBeTruthy();
    expect(cost.payments[0].amount).toBeCloseTo(20);
  });
});

// ─── Cost persistence across recurrence resets ──────────────────────────────

describe("Cost persistence across recurring event resets", () => {
  it("preserves EventCost settings after recurrence reset and applies to new players", async () => {
    // Create a recurring event with nextResetAt in the past so GET triggers a reset
    const event = await prisma.event.create({
      data: {
        title: "Weekly Futsal",
        location: "Pitch",
        dateTime: new Date(Date.now() - 7200_000), // 2 hours ago
        isRecurring: true,
        recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1 }),
        nextResetAt: new Date(Date.now() - 3600_000), // 1 hour ago
      },
    });

    // Add players and set cost with payment details
    for (const name of ["Alice", "Bob"]) {
      await prisma.player.create({
        data: { name, eventId: event.id, order: ["Alice", "Bob"].indexOf(name) },
      });
    }
    await setCost(ctx({ id: event.id }, {
      totalAmount: 50,
      currency: "USD",
      paymentDetails: "Revolut @jose",
    }));

    // Verify cost is set
    let costRes = await getCost(ctx({ id: event.id }));
    let cost = await costRes.json();
    expect(cost.totalAmount).toBe(50);
    expect(cost.currency).toBe("USD");
    expect(cost.paymentDetails).toBe("Revolut @jose");
    expect(cost.payments).toHaveLength(2);

    // Trigger recurrence reset via GET
    const eventRes = await getEvent({ params: { id: event.id } } as any);
    const eventBody = await eventRes.json();
    expect(eventBody.wasReset).toBe(true);
    // Players should be cleared
    expect(eventBody.players).toHaveLength(0);

    // EventCost should still exist with same settings, but no payments
    costRes = await getCost(ctx({ id: event.id }));
    cost = await costRes.json();
    expect(cost.totalAmount).toBe(50);
    expect(cost.currency).toBe("USD");
    expect(cost.paymentDetails).toBe("Revolut @jose");
    expect(cost.payments).toHaveLength(0);

    // Add new players to the next occurrence
    await addPlayer(postCtx({ id: event.id }, { name: "Charlie" }));
    await addPlayer(postCtx({ id: event.id }, { name: "Diana" }));
    await addPlayer(postCtx({ id: event.id }, { name: "Eve" }));

    // syncPaymentsForEvent should have created payments using the persisted EventCost
    costRes = await getCost(ctx({ id: event.id }));
    cost = await costRes.json();
    expect(cost.totalAmount).toBe(50);
    expect(cost.currency).toBe("USD");
    expect(cost.paymentDetails).toBe("Revolut @jose");
    expect(cost.payments).toHaveLength(3);
    // 50 / 3 ≈ 16.67 each
    expect(cost.payments[0].amount).toBeCloseTo(50 / 3);
    expect(cost.payments.every((p: any) => p.status === "pending")).toBe(true);
  });

  it("snapshots payments into GameHistory during recurrence reset", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Weekly Futsal",
        location: "Pitch",
        dateTime: new Date(Date.now() - 7200_000),
        isRecurring: true,
        recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1 }),
        nextResetAt: new Date(Date.now() - 3600_000),
      },
    });

    for (const name of ["Alice", "Bob"]) {
      await prisma.player.create({
        data: { name, eventId: event.id, order: ["Alice", "Bob"].indexOf(name) },
      });
    }
    await setCost(ctx({ id: event.id }, { totalAmount: 40, currency: "EUR" }));
    await updatePayment(ctx({ id: event.id }, { playerName: "Alice", status: "paid", method: "revolut" }));

    // Trigger reset
    await getEvent({ params: { id: event.id } } as any);

    // Check that GameHistory has the payments snapshot
    const history = await prisma.gameHistory.findFirst({
      where: { eventId: event.id },
    });
    expect(history).toBeTruthy();
    expect(history!.paymentsSnapshot).toBeTruthy();
    const snapshot = JSON.parse(history!.paymentsSnapshot!);
    expect(snapshot).toHaveLength(2);
    const alice = snapshot.find((p: any) => p.playerName === "Alice");
    expect(alice.status).toBe("paid");
    expect(alice.method).toBe("revolut");
    expect(alice.amount).toBeCloseTo(20);
  });
});

// ─── Structured payment methods ─────────────────────────────────────────────

describe("Structured payment methods on EventCost", () => {
  it("saves structured paymentMethods via PUT /cost", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [
        { type: "mbway", value: "912345678" },
        { type: "revolut_tag", value: "@jose" },
      ],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentMethods).toBeTruthy();
    const methods = JSON.parse(body.paymentMethods);
    expect(methods).toHaveLength(2);
    expect(methods[0]).toEqual({ type: "mbway", value: "912345678" });
    expect(methods[1]).toEqual({ type: "revolut_tag", value: "jose" }); // normalized: @ stripped
  });

  it("returns paymentMethods in GET /cost", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [{ type: "revolut_link", value: "https://revolut.me/jose123" }],
    }));
    const res = await getCost(ctx({ id: eventId }));
    const body = await res.json();
    const methods = JSON.parse(body.paymentMethods);
    expect(methods).toHaveLength(1);
    expect(methods[0].type).toBe("revolut_link");
  });

  it("rejects invalid payment method type", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [{ type: "bitcoin", value: "abc" }],
    }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid revolut link domain", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [{ type: "revolut_link", value: "https://example.com/pay" }],
    }));
    expect(res.status).toBe(400);
  });

  it("rejects phone number with too few digits", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [{ type: "phone", value: "123" }],
    }));
    expect(res.status).toBe(400);
  });

  it("clears paymentMethods when set to null", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [{ type: "mbway", value: "912345678" }],
    }));
    const res = await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: null,
    }));
    const body = await res.json();
    expect(body.paymentMethods).toBeNull();
  });

  it("clears paymentMethods when set to empty array", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [{ type: "mbway", value: "912345678" }],
    }));
    const res = await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [],
    }));
    const body = await res.json();
    expect(body.paymentMethods).toBeNull();
  });

  it("preserves paymentMethods when not sent in update", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [{ type: "mbway", value: "912345678" }],
    }));
    // Update only totalAmount, don't send paymentMethods
    const res = await setCost(ctx({ id: eventId }, { totalAmount: 60 }));
    const body = await res.json();
    expect(body.paymentMethods).toBeTruthy();
    const methods = JSON.parse(body.paymentMethods);
    expect(methods[0].type).toBe("mbway");
  });

  it("works alongside legacy paymentDetails", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentDetails: "Legacy text info",
      paymentMethods: [{ type: "revolut_tag", value: "jose" }],
    }));
    const body = await res.json();
    expect(body.paymentDetails).toBe("Legacy text info");
    const methods = JSON.parse(body.paymentMethods);
    expect(methods[0].type).toBe("revolut_tag");
  });

  it("persists paymentMethods across recurrence reset", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Weekly Futsal",
        location: "Pitch",
        dateTime: new Date(Date.now() - 7200_000),
        isRecurring: true,
        recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1 }),
        nextResetAt: new Date(Date.now() - 3600_000),
      },
    });
    for (const name of ["Alice", "Bob"]) {
      await prisma.player.create({
        data: { name, eventId: event.id, order: ["Alice", "Bob"].indexOf(name) },
      });
    }
    await setCost(ctx({ id: event.id }, {
      totalAmount: 50,
      paymentMethods: [
        { type: "mbway", value: "912345678" },
        { type: "revolut_tag", value: "jose" },
      ],
    }));

    // Trigger recurrence reset
    await getEvent({ params: { id: event.id } } as any);

    // EventCost should still have paymentMethods
    const costRes = await getCost(ctx({ id: event.id }));
    const cost = await costRes.json();
    const methods = JSON.parse(cost.paymentMethods);
    expect(methods).toHaveLength(2);
    expect(methods[0].type).toBe("mbway");
    expect(methods[1].type).toBe("revolut_tag");
  });
});

// ─── Temporary payment method override ──────────────────────────────────────

describe("PUT /api/events/[id]/cost/override", () => {
  it("sets temp override; GET /cost returns hasOverride and effective methods", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [{ type: "mbway", value: "912345678" }],
      paymentDetails: "Default details",
    }));

    const res = await setOverride(ctx({ id: eventId }, {
      paymentMethods: [{ type: "revolut_tag", value: "temp_jose" }],
      paymentDetails: "Temp details",
    }));
    expect(res.status).toBe(200);

    const costRes = await getCost(ctx({ id: eventId }));
    const cost = await costRes.json();
    expect(cost.hasOverride).toBe(true);
    // Effective methods should be the override
    const effective = JSON.parse(cost.effectivePaymentMethods);
    expect(effective).toHaveLength(1);
    expect(effective[0].type).toBe("revolut_tag");
    expect(cost.effectivePaymentDetails).toBe("Temp details");
    // Raw defaults still returned
    const raw = JSON.parse(cost.paymentMethods);
    expect(raw[0].type).toBe("mbway");
  });

  it("rejects invalid payment methods in override", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 50 }));

    const res = await setOverride(ctx({ id: eventId }, {
      paymentMethods: [{ type: "bitcoin", value: "abc" }],
    }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when no cost exists", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await setOverride(ctx({ id: eventId }, {
      paymentMethods: [{ type: "mbway", value: "912345678" }],
    }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-owner tries to set override on owned event", async () => {
    const eventId = await seedOwnedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 50 }));

    const res = await setOverride(ctx({ id: eventId }, {
      paymentMethods: [{ type: "mbway", value: "912345678" }],
    }));
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/events/[id]/cost/override", () => {
  it("clears temp override; effective methods revert to defaults", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [{ type: "mbway", value: "912345678" }],
      paymentDetails: "Default details",
    }));
    await setOverride(ctx({ id: eventId }, {
      paymentMethods: [{ type: "revolut_tag", value: "temp_jose" }],
      paymentDetails: "Temp details",
    }));

    const res = await clearOverride(deleteCtx({ id: eventId }));
    expect(res.status).toBe(200);

    const costRes = await getCost(ctx({ id: eventId }));
    const cost = await costRes.json();
    expect(cost.hasOverride).toBe(false);
    const effective = JSON.parse(cost.effectivePaymentMethods);
    expect(effective[0].type).toBe("mbway");
    expect(cost.effectivePaymentDetails).toBe("Default details");
  });

  it("returns 404 when no cost exists", async () => {
    const eventId = await seedEvent(["Alice"]);
    const res = await clearOverride(deleteCtx({ id: eventId }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-owner tries to clear override on owned event", async () => {
    const eventId = await seedOwnedEvent(["Alice"]);
    // setCost bypasses auth (no ownerId check in test helper context),
    // so we set cost directly via prisma
    await prisma.eventCost.create({
      data: {
        eventId,
        totalAmount: 50,
        currency: "EUR",
        tempPaymentMethods: JSON.stringify([{ type: "mbway", value: "912345678" }]),
      },
    });

    const res = await clearOverride(deleteCtx({ id: eventId }));
    expect(res.status).toBe(403);
  });
});

describe("Recurrence reset clears temp override", () => {
  it("clears tempPaymentMethods and tempPaymentDetails on reset", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Weekly Futsal",
        location: "Pitch",
        dateTime: new Date(Date.now() - 7200_000),
        isRecurring: true,
        recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1 }),
        nextResetAt: new Date(Date.now() - 3600_000),
      },
    });
    for (const name of ["Alice", "Bob"]) {
      await prisma.player.create({
        data: { name, eventId: event.id, order: ["Alice", "Bob"].indexOf(name) },
      });
    }
    await setCost(ctx({ id: event.id }, {
      totalAmount: 50,
      paymentMethods: [{ type: "mbway", value: "912345678" }],
    }));
    // Set override
    await setOverride(ctx({ id: event.id }, {
      paymentMethods: [{ type: "revolut_tag", value: "temp_jose" }],
      paymentDetails: "Temp for this week",
    }));

    // Verify override is set
    let costRes = await getCost(ctx({ id: event.id }));
    let cost = await costRes.json();
    expect(cost.hasOverride).toBe(true);

    // Trigger recurrence reset
    await getEvent({ params: { id: event.id } } as any);

    // Override should be cleared
    costRes = await getCost(ctx({ id: event.id }));
    cost = await costRes.json();
    expect(cost.hasOverride).toBe(false);
    // Effective should be the default
    const effective = JSON.parse(cost.effectivePaymentMethods);
    expect(effective[0].type).toBe("mbway");
    expect(cost.effectivePaymentDetails).toBeNull();
  });
});

describe("GET /cost without override returns defaults as effective", () => {
  it("returns effectivePaymentMethods from defaults when no override", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, {
      totalAmount: 50,
      paymentMethods: [{ type: "mbway", value: "912345678" }],
      paymentDetails: "Default info",
    }));

    const costRes = await getCost(ctx({ id: eventId }));
    const cost = await costRes.json();
    expect(cost.hasOverride).toBe(false);
    const effective = JSON.parse(cost.effectivePaymentMethods);
    expect(effective[0].type).toBe("mbway");
    expect(cost.effectivePaymentDetails).toBe("Default info");
  });

  it("returns override as effective even when no default payment methods are set", async () => {
    const eventId = await seedEvent(["Alice"]);
    // Set cost WITHOUT any default payment methods
    await setCost(ctx({ id: eventId }, { totalAmount: 50 }));

    // Set override
    await setOverride(ctx({ id: eventId }, {
      paymentMethods: [{ type: "revolut_tag", value: "temp_jose" }],
      paymentDetails: "Temp details only",
    }));

    const costRes = await getCost(ctx({ id: eventId }));
    const cost = await costRes.json();
    expect(cost.hasOverride).toBe(true);
    expect(cost.paymentMethods).toBeNull(); // no default
    expect(cost.effectivePaymentMethods).toBeTruthy(); // override is effective
    const effective = JSON.parse(cost.effectivePaymentMethods);
    expect(effective).toHaveLength(1);
    expect(effective[0].type).toBe("revolut_tag");
    expect(effective[0].value).toBe("temp_jose");
    expect(cost.effectivePaymentDetails).toBe("Temp details only");
  });
});
