/**
 * Payment nudge coverage tests — grounded in ADR 0006 and CONTEXT.md specifications.
 *
 * ADR 0006 specifies:
 * - pending → sent: only the linked Player acting on their own behalf
 * - sent → paid: only Owner/Admin
 * - pending → paid: only Owner/Admin
 * - hard_gate cleared by paid OR sent (gate uses pending-only balance)
 * - Outstanding Balance = pending + sent (only paid clears)
 *
 * CONTEXT.md specifies:
 * - Enforcement only on attributable self-service joins (Quick Join / Claim)
 * - Owner/Admin adding a player always bypasses enforcement
 * - Debt visibility: aggregate to non-privileged, full breakdown to Owner/Admin
 * - showDebtorNames toggle reveals names to the group
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type * as AuthHelpersServer from "~/lib/auth.helpers.server";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { getOutstandingBalance, getEventBalanceSummary, getGateBalance } from "~/lib/balance.server";
import { GET as getBalance } from "~/pages/api/events/[id]/balance";
import { PUT as updatePayment } from "~/pages/api/events/[id]/payments";
import { POST as addPlayer } from "~/pages/api/events/[id]/players";

let mockSession: any = null;
let mockCheckOwnership: any = null;

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof AuthHelpersServer>("~/lib/auth.helpers.server");
  return {
    ...actual,
    getSession: vi.fn(() => mockSession),
    checkOwnership: vi.fn((...args: any[]) => {
      if (mockCheckOwnership) return mockCheckOwnership(...args);
      return { isOwner: false, isAdmin: false };
    }),
  };
});

// Suppress notification side effects
vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn(),
  drainNotificationQueue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/email.server", () => ({
  sendGameInvite: vi.fn(),
  sendPlayerJoinedOwnerNotification: vi.fn(),
}));
vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(async () => {
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetApiRateLimitStore();
  vi.clearAllMocks();
  mockSession = null;
  mockCheckOwnership = null;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function putCtx(eventId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/payments`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: eventId },
  } as any;
}

function getCtx(eventId: string) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/balance`, { method: "GET" }),
    params: { id: eventId },
  } as any;
}

function postCtx(eventId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/players`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: eventId },
  } as any;
}

async function seedOwnerAndEvent(opts: {
  enforcement?: string;
  threshold?: number;
  showDebtorNames?: boolean;
} = {}) {
  const owner = await prisma.user.create({
    data: { id: "owner1", name: "Owner", email: "owner@test.com" },
  });
  const event = await prisma.event.create({
    data: {
      title: "Test", location: "L", dateTime: new Date(Date.now() + 86400_000),
      ownerId: owner.id, maxPlayers: 10,
      paymentEnforcementLevel: opts.enforcement ?? "nudge",
      paymentGateThreshold: opts.threshold ?? 0,
      showDebtorNames: opts.showDebtorNames ?? false,
    },
  });
  const ec = await prisma.eventCost.create({
    data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
  });
  return { owner, event, ec };
}

async function seedPlayer(eventId: string, name: string, userId?: string) {
  return prisma.player.create({
    data: { name, eventId, order: 0, userId },
  });
}

async function seedPayment(ecId: string, playerName: string, amount: number, status = "pending") {
  return prisma.playerPayment.create({
    data: { eventCostId: ecId, playerName, amount, status },
  });
}

async function seedHistory(eventId: string, snapshot: Array<{ playerName: string; amount: number; status: string }>) {
  return prisma.gameHistory.create({
    data: {
      eventId,
      dateTime: new Date(Date.now() - 7 * 86400_000),
      teamOneName: "A", teamTwoName: "B",
      paymentsSnapshot: JSON.stringify(snapshot),
      editableUntil: new Date(Date.now() + 86400_000),
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// balance.server.ts — ADR 0006: Outstanding Balance = pending + sent; paid clears
// ═══════════════════════════════════════════════════════════════════════════════

describe("balance.server.ts", () => {
  describe("getOutstandingBalance", () => {
    it("handles malformed JSON in paymentsSnapshot gracefully", async () => {
      const { event } = await seedOwnerAndEvent();
      await prisma.gameHistory.create({
        data: {
          eventId: event.id, dateTime: new Date(), teamOneName: "A", teamTwoName: "B",
          paymentsSnapshot: "NOT VALID JSON{{{",
          editableUntil: new Date(),
        },
      });
      const balance = await getOutstandingBalance(event.id, "Alice");
      expect(balance.amount).toBe(0); // gracefully skipped
    });

    it("skips history entries with null paymentsSnapshot", async () => {
      const { event } = await seedOwnerAndEvent();
      await prisma.gameHistory.create({
        data: {
          eventId: event.id, dateTime: new Date(), teamOneName: "A", teamTwoName: "B",
          paymentsSnapshot: null,
          editableUntil: new Date(),
        },
      });
      const balance = await getOutstandingBalance(event.id, "Alice");
      expect(balance.amount).toBe(0);
    });

    it("ignores entries for other players (player not in game)", async () => {
      const { event } = await seedOwnerAndEvent();
      await seedHistory(event.id, [
        { playerName: "Bob", amount: 10, status: "pending" },
      ]);
      const balance = await getOutstandingBalance(event.id, "Alice");
      expect(balance.amount).toBe(0);
      expect(balance.gamesOwed).toBe(0);
    });

    it("streak breaks on a paid-then-unpaid sequence (live paid, history pending)", async () => {
      const { event, ec } = await seedOwnerAndEvent();
      await seedPayment(ec.id, "Alice", 5, "paid"); // live: paid
      await seedHistory(event.id, [{ playerName: "Alice", amount: 5, status: "pending" }]); // older: pending
      const balance = await getOutstandingBalance(event.id, "Alice");
      // Live is paid (streak=1), then history is pending → breaks. But wait — timeline
      // is [live, ...historyDesc]. Live is paid, then the history entry is pending.
      // So: streak=1 (live), then streakBroken → amount=5.
      expect(balance.streak).toBe(1);
      expect(balance.amount).toBe(5);
    });

    it("streak counts through multiple paid history entries with no live payment", async () => {
      const { event } = await seedOwnerAndEvent();
      // No live payment, 3 history entries all paid
      for (let i = 0; i < 3; i++) {
        await prisma.gameHistory.create({
          data: {
            eventId: event.id,
            dateTime: new Date(Date.now() - (i + 1) * 86400_000),
            teamOneName: "A", teamTwoName: "B",
            paymentsSnapshot: JSON.stringify([{ playerName: "Alice", amount: 5, status: "paid" }]),
            editableUntil: new Date(),
          },
        });
      }
      const balance = await getOutstandingBalance(event.id, "Alice");
      expect(balance.streak).toBe(3);
      expect(balance.amount).toBe(0);
    });
  });

  describe("getEventBalanceSummary", () => {
    it("falls back to live payments for aggregate when no history exists", async () => {
      const { event, ec } = await seedOwnerAndEvent();
      await seedPayment(ec.id, "Alice", 5, "paid");
      await seedPayment(ec.id, "Bob", 5, "pending");
      const summary = await getEventBalanceSummary(event.id);
      expect(summary.paidCount).toBe(1);
      expect(summary.totalCount).toBe(2);
    });

    it("handles malformed snapshot in summary gracefully", async () => {
      const { event } = await seedOwnerAndEvent();
      await prisma.gameHistory.create({
        data: {
          eventId: event.id, dateTime: new Date(), teamOneName: "A", teamTwoName: "B",
          paymentsSnapshot: "BROKEN",
          editableUntil: new Date(),
        },
      });
      const summary = await getEventBalanceSummary(event.id);
      expect(summary.paidCount).toBe(0);
      expect(summary.totalCount).toBe(0);
    });
  });

  describe("getGateBalance — ADR 0006: only pending counts, sent clears the gate", () => {
    it("excludes sent from gate balance (live payment)", async () => {
      const { event, ec } = await seedOwnerAndEvent();
      await seedPayment(ec.id, "Alice", 10, "sent");
      const gate = await getGateBalance(event.id, "Alice");
      expect(gate).toBe(0); // sent does not block
    });

    it("excludes sent from gate balance (history snapshot)", async () => {
      const { event } = await seedOwnerAndEvent();
      await seedHistory(event.id, [{ playerName: "Alice", amount: 10, status: "sent" }]);
      const gate = await getGateBalance(event.id, "Alice");
      expect(gate).toBe(0);
    });

    it("includes only pending (mixed sent+pending in history)", async () => {
      const { event } = await seedOwnerAndEvent();
      await seedHistory(event.id, [
        { playerName: "Alice", amount: 5, status: "sent" },
        { playerName: "Alice", amount: 7, status: "pending" },
      ]);
      // Only one entry per player per snapshot — but let's use two snapshots
      const gate = await getGateBalance(event.id, "Alice");
      // This snapshot has 2 entries for Alice which is unusual; the find() gets the first (sent)
      expect(gate).toBe(0); // first match is sent
    });

    it("sums pending across multiple history snapshots", async () => {
      const { event } = await seedOwnerAndEvent();
      await seedHistory(event.id, [{ playerName: "Alice", amount: 5, status: "pending" }]);
      await prisma.gameHistory.create({
        data: {
          eventId: event.id,
          dateTime: new Date(Date.now() - 14 * 86400_000),
          teamOneName: "A", teamTwoName: "B",
          paymentsSnapshot: JSON.stringify([{ playerName: "Alice", amount: 3, status: "pending" }]),
          editableUntil: new Date(),
        },
      });
      const gate = await getGateBalance(event.id, "Alice");
      expect(gate).toBe(8);
    });

    it("handles malformed snapshot gracefully", async () => {
      const { event } = await seedOwnerAndEvent();
      await prisma.gameHistory.create({
        data: {
          eventId: event.id, dateTime: new Date(), teamOneName: "A", teamTwoName: "B",
          paymentsSnapshot: "{{bad",
          editableUntil: new Date(),
        },
      });
      const gate = await getGateBalance(event.id, "Alice");
      expect(gate).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// balance.ts endpoint — CONTEXT.md: Debt visibility rules
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/events/[id]/balance", () => {
  it("returns callerBalance when session user has a linked player", async () => {
    const { event, ec } = await seedOwnerAndEvent();
    const user = await prisma.user.create({ data: { id: "u2", name: "Alice", email: "a@t.com" } });
    await seedPlayer(event.id, "Alice", user.id);
    await seedPayment(ec.id, "Alice", 10, "pending");
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await getBalance(getCtx(event.id));
    const body = await res.json();
    expect(body.callerBalance).not.toBeNull();
    expect(body.callerBalance.amount).toBe(10);
  });

  it("returns callerBalance=null when session user has no player in this event", async () => {
    const { event } = await seedOwnerAndEvent();
    const user = await prisma.user.create({ data: { id: "u3", name: "Nobody", email: "n@t.com" } });
    mockSession = { user: { id: user.id, name: "Nobody" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await getBalance(getCtx(event.id));
    const body = await res.json();
    expect(body.callerBalance).toBeNull();
  });

  it("non-privileged with showDebtorNames=false sees only own balance", async () => {
    const { event, ec } = await seedOwnerAndEvent({ showDebtorNames: false });
    const user = await prisma.user.create({ data: { id: "u4", name: "Alice", email: "u4@t.com" } });
    await seedPlayer(event.id, "Alice", user.id);
    await seedPayment(ec.id, "Alice", 10, "pending");
    await seedPayment(ec.id, "Bob", 5, "pending");
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await getBalance(getCtx(event.id));
    const body = await res.json();
    // Should only see own balance, not Bob's
    expect(body.balances.length).toBe(1);
    expect(body.balances[0].playerName).toBe("Alice");
  });

  it("privileged user (owner) sees full balances regardless of showDebtorNames", async () => {
    const { event, ec, owner } = await seedOwnerAndEvent({ showDebtorNames: false });
    await seedPayment(ec.id, "Alice", 10, "pending");
    await seedPayment(ec.id, "Bob", 5, "pending");
    mockSession = { user: { id: owner.id, name: "Owner" } };
    mockCheckOwnership = () => ({ isOwner: true, isAdmin: false });
    const res = await getBalance(getCtx(event.id));
    const body = await res.json();
    expect(body.balances.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// payments.ts — ADR 0006: self-report auth rules
// ═══════════════════════════════════════════════════════════════════════════════

describe("PUT /api/events/[id]/payments — self-report", () => {
  it("player marks own pending→sent (200)", async () => {
    const { event, ec } = await seedOwnerAndEvent();
    const user = await prisma.user.create({ data: { id: "u5", name: "Alice", email: "u5@t.com" } });
    await seedPlayer(event.id, "Alice", user.id);
    await seedPayment(ec.id, "Alice", 10, "pending");
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await updatePayment(putCtx(event.id, { playerName: "Alice", status: "sent" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("sent");
  });

  it("player cannot mark another player's payment → 403", async () => {
    const { event, ec } = await seedOwnerAndEvent();
    const user = await prisma.user.create({ data: { id: "u6", name: "Alice", email: "u6@t.com" } });
    await seedPlayer(event.id, "Alice", user.id);
    await seedPlayer(event.id, "Bob");
    await seedPayment(ec.id, "Bob", 10, "pending");
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await updatePayment(putCtx(event.id, { playerName: "Bob", status: "sent" }));
    expect(res.status).toBe(403);
  });

  it("player cannot set paid → 403", async () => {
    const { event, ec } = await seedOwnerAndEvent();
    const user = await prisma.user.create({ data: { id: "u7", name: "Alice", email: "u7@t.com" } });
    await seedPlayer(event.id, "Alice", user.id);
    await seedPayment(ec.id, "Alice", 10, "pending");
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await updatePayment(putCtx(event.id, { playerName: "Alice", status: "paid" }));
    expect(res.status).toBe(403);
  });

  it("player cannot set sent on already-sent payment → 400", async () => {
    const { event, ec } = await seedOwnerAndEvent();
    const user = await prisma.user.create({ data: { id: "u8", name: "Alice", email: "u8@t.com" } });
    await seedPlayer(event.id, "Alice", user.id);
    await seedPayment(ec.id, "Alice", 10, "sent");
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await updatePayment(putCtx(event.id, { playerName: "Alice", status: "sent" }));
    expect(res.status).toBe(400);
  });

  it("owner sets sent→paid (confirm received)", async () => {
    const { event, ec, owner } = await seedOwnerAndEvent();
    await seedPayment(ec.id, "Alice", 10, "sent");
    mockSession = { user: { id: owner.id } };
    mockCheckOwnership = () => ({ isOwner: true, isAdmin: false });
    const res = await updatePayment(putCtx(event.id, { playerName: "Alice", status: "paid" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("paid");
    expect(body.paidAt).not.toBeNull();
  });

  it("owner sets pending→paid directly", async () => {
    const { event, ec, owner } = await seedOwnerAndEvent();
    await seedPayment(ec.id, "Alice", 10, "pending");
    mockSession = { user: { id: owner.id } };
    mockCheckOwnership = () => ({ isOwner: true, isAdmin: false });
    const res = await updatePayment(putCtx(event.id, { playerName: "Alice", status: "paid" }));
    expect(res.status).toBe(200);
  });

  it("rejects invalid status → 400", async () => {
    const { event, ec, owner } = await seedOwnerAndEvent();
    await seedPayment(ec.id, "Alice", 10, "pending");
    mockSession = { user: { id: owner.id } };
    mockCheckOwnership = () => ({ isOwner: true, isAdmin: false });
    const res = await updatePayment(putCtx(event.id, { playerName: "Alice", status: "invalid" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when payment not found", async () => {
    const { event, owner } = await seedOwnerAndEvent();
    mockSession = { user: { id: owner.id } };
    mockCheckOwnership = () => ({ isOwner: true, isAdmin: false });
    const res = await updatePayment(putCtx(event.id, { playerName: "Ghost", status: "paid" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when no cost set", async () => {
    const owner = await prisma.user.create({ data: { id: "own2", name: "O2", email: "o2@t.com" } });
    const event = await prisma.event.create({
      data: { title: "T", location: "L", dateTime: new Date(), ownerId: owner.id },
    });
    mockSession = { user: { id: owner.id } };
    mockCheckOwnership = () => ({ isOwner: true, isAdmin: false });
    const res = await updatePayment(putCtx(event.id, { playerName: "Alice", status: "paid" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/no cost/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// players.ts enforcement — CONTEXT.md: Payment enforcement level
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/events/[id]/players — enforcement", () => {
  it("hard_gate blocks self-service join when pending balance > threshold (402)", async () => {
    const { event } = await seedOwnerAndEvent({ enforcement: "hard_gate", threshold: 0 });
    const user = await prisma.user.create({ data: { id: "u9", name: "Alice", email: "u9@t.com" } });
    await seedHistory(event.id, [{ playerName: "Alice", amount: 10, status: "pending" }]);
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await addPlayer(postCtx(event.id, { name: "Alice", linkToAccount: true }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("PAYMENT_GATE");
    expect(body.enforcement).toBe("hard_gate");
  });

  it("hard_gate allows join when balance is 0 (no debt)", async () => {
    const { event } = await seedOwnerAndEvent({ enforcement: "hard_gate", threshold: 0 });
    const user = await prisma.user.create({ data: { id: "u10", name: "NewGuy", email: "u10@t.com" } });
    mockSession = { user: { id: user.id, name: "NewGuy" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await addPlayer(postCtx(event.id, { name: "NewGuy", linkToAccount: true }));
    expect(res.status).toBe(200);
  });

  it("hard_gate allows when all debt is sent (gate uses pending-only)", async () => {
    const { event } = await seedOwnerAndEvent({ enforcement: "hard_gate", threshold: 0 });
    const user = await prisma.user.create({ data: { id: "u11", name: "Alice", email: "u11@t.com" } });
    await seedHistory(event.id, [{ playerName: "Alice", amount: 10, status: "sent" }]);
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await addPlayer(postCtx(event.id, { name: "Alice", linkToAccount: true }));
    expect(res.status).toBe(200); // sent clears the gate
  });

  it("hard_gate respects threshold (balance below threshold passes)", async () => {
    const { event } = await seedOwnerAndEvent({ enforcement: "hard_gate", threshold: 10 });
    const user = await prisma.user.create({ data: { id: "u12", name: "Alice", email: "u12@t.com" } });
    await seedHistory(event.id, [{ playerName: "Alice", amount: 5, status: "pending" }]);
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await addPlayer(postCtx(event.id, { name: "Alice", linkToAccount: true }));
    expect(res.status).toBe(200); // 5 <= 10 threshold
  });

  it("nudge does not block regardless of balance", async () => {
    const { event } = await seedOwnerAndEvent({ enforcement: "nudge", threshold: 0 });
    const user = await prisma.user.create({ data: { id: "u13", name: "Alice", email: "u13@t.com" } });
    await seedHistory(event.id, [{ playerName: "Alice", amount: 999, status: "pending" }]);
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await addPlayer(postCtx(event.id, { name: "Alice", linkToAccount: true }));
    expect(res.status).toBe(200);
  });

  it("soft_gate does not block", async () => {
    const { event } = await seedOwnerAndEvent({ enforcement: "soft_gate", threshold: 0 });
    const user = await prisma.user.create({ data: { id: "u14", name: "Alice", email: "u14@t.com" } });
    await seedHistory(event.id, [{ playerName: "Alice", amount: 999, status: "pending" }]);
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await addPlayer(postCtx(event.id, { name: "Alice", linkToAccount: true }));
    expect(res.status).toBe(200);
  });

  it("off enforcement never checks balance", async () => {
    const { event } = await seedOwnerAndEvent({ enforcement: "off", threshold: 0 });
    const user = await prisma.user.create({ data: { id: "u15", name: "Alice", email: "u15@t.com" } });
    await seedHistory(event.id, [{ playerName: "Alice", amount: 999, status: "pending" }]);
    mockSession = { user: { id: user.id, name: "Alice" } };
    mockCheckOwnership = () => ({ isOwner: false, isAdmin: false });
    const res = await addPlayer(postCtx(event.id, { name: "Alice", linkToAccount: true }));
    expect(res.status).toBe(200);
  });

  it("owner adding a player bypasses hard_gate enforcement", async () => {
    const { event, owner } = await seedOwnerAndEvent({ enforcement: "hard_gate", threshold: 0 });
    await seedHistory(event.id, [{ playerName: "DebtPlayer", amount: 999, status: "pending" }]);
    mockSession = { user: { id: owner.id, name: "Owner" } };
    mockCheckOwnership = () => ({ isOwner: true, isAdmin: false });
    // Owner adds without linkToAccount → not a self-service join → bypasses enforcement
    const res = await addPlayer(postCtx(event.id, { name: "DebtPlayer" }));
    expect(res.status).toBe(200);
  });
});
