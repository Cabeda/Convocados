import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Import route handlers
import { PUT as setCost, GET as getCost, DELETE as deleteCost } from "~/pages/api/events/[id]/cost";
import { GET as getPayments, PUT as updatePayment } from "~/pages/api/events/[id]/payments";
import { POST as addPlayer, DELETE as removePlayer } from "~/pages/api/events/[id]/players";

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

beforeEach(async () => {
  resetApiRateLimitStore();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
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

  it("marks a player as exempt", async () => {
    const eventId = await seedEvent(["Alice"]);
    await setCost(ctx({ id: eventId }, { totalAmount: 50 }));

    const res = await updatePayment(ctx({ id: eventId }, {
      playerName: "Alice",
      status: "exempt",
    }));
    const body = await res.json();
    expect(body.status).toBe("exempt");
  });

  it("toggles back to pending", async () => {
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
    await updatePayment(ctx({ id: eventId }, { playerName: "Bob", status: "exempt" }));

    const res = await getPayments(ctx({ id: eventId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payments).toHaveLength(3);
    expect(body.summary.paidCount).toBe(1);
    expect(body.summary.exemptCount).toBe(1);
    expect(body.summary.pendingCount).toBe(1);
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
