import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";

// ── Mock Resend ───────────────────────────────────────────────────────────────
const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

// ── Mock web-push (for push notifications) ────────────────────────────────────
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({}),
  },
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn().mockResolvedValue({}),
}));

// ── Mock auth ─────────────────────────────────────────────────────────────────
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

import { _resetResendClient, sendPaymentReminder } from "~/lib/email.server";
import {
  getPlayersWithPendingPayments,
  markPaymentReminderSent,
  shouldSendPaymentReminder,
} from "~/lib/paymentReminders.server";
import { getNotificationPrefs, wantsPaymentReminderEmail } from "~/lib/notificationPrefs.server";

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedUser(id = "user-pay-1", email = "pay1@test.com") {
  await prisma.user.upsert({
    where: { id },
    update: {},
    create: { id, name: "Pay User", email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  });
  return id;
}

async function seedEvent(ownerId: string, id = "evt-pay-1") {
  const dateTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday
  await prisma.event.upsert({
    where: { id },
    update: {},
    create: {
      id, title: "Payment Game", location: "Test Field", dateTime,
      maxPlayers: 10, ownerId, createdAt: new Date(), updatedAt: new Date(),
    },
  });
  return id;
}

async function seedGameHistory(eventId: string, id = "gh-pay-1") {
  const dateTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.gameHistory.upsert({
    where: { id },
    update: {},
    create: {
      id, eventId, dateTime, status: "played",
      teamOneName: "Team A", teamTwoName: "Team B",
      editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    },
  });
  return id;
}

async function seedCostAndPayment(eventId: string, playerName: string, status = "pending") {
  const eventCost = await prisma.eventCost.upsert({
    where: { eventId },
    update: {},
    create: { eventId, totalAmount: 10, currency: "EUR" },
  });
  await prisma.playerPayment.upsert({
    where: { eventCostId_playerName: { eventCostId: eventCost.id, playerName } },
    update: { status },
    create: { eventCostId: eventCost.id, playerName, amount: 5, status },
  });
  return eventCost;
}

async function seedPlayer(eventId: string, name: string, userId: string | null = null, id?: string) {
  return prisma.player.create({
    data: { id, name, eventId, userId },
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.clearAllMocks();
  _resetResendClient();
  await prisma.paymentReminderLog.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

// ── sendPaymentReminder email tests ───────────────────────────────────────────

describe("sendPaymentReminder", () => {
  it("sends email with event title and amount", async () => {
    mockSend.mockResolvedValue({ data: { id: "pr-1" }, error: null });

    await sendPaymentReminder("player@example.com", {
      eventTitle: "Friday Futsal",
      amount: "5.00",
      currency: "EUR",
      eventUrl: "https://convocados.fly.dev/events/abc",
    });

    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toBe("player@example.com");
    expect(call.subject).toContain("Friday Futsal");
    expect(call.html).toContain("5.00");
    expect(call.html).toContain("EUR");
    expect(call.html).toContain("/events/abc");
  });

  it("throws on Resend error", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "Bad request", name: "validation_error" } });

    await expect(
      sendPaymentReminder("p@example.com", {
        eventTitle: "Game",
        amount: "5.00",
        currency: "EUR",
        eventUrl: "https://convocados.fly.dev/events/x",
      }),
    ).rejects.toThrow("Failed to send payment reminder");
  });

  it("includes unsubscribe link", async () => {
    mockSend.mockResolvedValue({ data: { id: "pr-2" }, error: null });

    await sendPaymentReminder("p@example.com", {
      eventTitle: "Game",
      amount: "5.00",
      currency: "EUR",
      eventUrl: "https://convocados.fly.dev/events/x",
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain("unsubscribe");
  });
});

// ── getPlayersWithPendingPayments tests ───────────────────────────────────────

describe("getPlayersWithPendingPayments", () => {
  it("returns players with pending payments for played games", async () => {
    const userId = await seedUser();
    const eventId = await seedEvent(userId);
    await seedGameHistory(eventId);
    await seedPlayer(eventId, "Pay User", userId);
    await seedCostAndPayment(eventId, "Pay User", "pending");

    const results = await getPlayersWithPendingPayments();
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find((r) => r.eventId === eventId && r.userId === userId);
    expect(match).toBeDefined();
    expect(match!.email).toBe("pay1@test.com");
    expect(match!.amount).toBe(5);
  });

  it("excludes players who already paid", async () => {
    const userId = await seedUser();
    const eventId = await seedEvent(userId);
    await seedGameHistory(eventId);
    await seedPlayer(eventId, "Pay User", userId);
    await seedCostAndPayment(eventId, "Pay User", "paid");

    const results = await getPlayersWithPendingPayments();
    expect(results.every((r) => !(r.eventId === eventId && r.userId === userId))).toBe(true);
  });

  it("excludes exempt players", async () => {
    const userId = await seedUser();
    const eventId = await seedEvent(userId);
    await seedGameHistory(eventId);
    await seedPlayer(eventId, "Pay User", userId);
    await seedCostAndPayment(eventId, "Pay User", "exempt");

    const results = await getPlayersWithPendingPayments();
    expect(results.every((r) => !(r.eventId === eventId && r.userId === userId))).toBe(true);
  });

  it("excludes anonymous players (no userId)", async () => {
    const userId = await seedUser();
    const eventId = await seedEvent(userId);
    await seedGameHistory(eventId);
    await seedPlayer(eventId, "Anon Player", null);
    await seedCostAndPayment(eventId, "Anon Player", "pending");

    const results = await getPlayersWithPendingPayments();
    expect(results.every((r) => r.playerName !== "Anon Player")).toBe(true);
  });

  it("excludes cancelled games", async () => {
    const userId = await seedUser();
    const eventId = await seedEvent(userId);
    // Create a cancelled game history
    await prisma.gameHistory.create({
      data: {
        eventId, dateTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
        status: "cancelled", teamOneName: "A", teamTwoName: "B",
        editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await seedPlayer(eventId, "Pay User", userId);
    await seedCostAndPayment(eventId, "Pay User", "pending");

    const results = await getPlayersWithPendingPayments();
    expect(results.every((r) => !(r.eventId === eventId && r.userId === userId))).toBe(true);
  });
});

// ── shouldSendPaymentReminder (daily dedup) ───────────────────────────────────

describe("shouldSendPaymentReminder", () => {
  it("returns true if no reminder sent today", async () => {
    const result = await shouldSendPaymentReminder("evt-1", "user-1");
    expect(result).toBe(true);
  });

  it("returns false if reminder already sent today", async () => {
    await markPaymentReminderSent("evt-1", "user-1");
    const result = await shouldSendPaymentReminder("evt-1", "user-1");
    expect(result).toBe(false);
  });

  it("returns true if reminder was sent yesterday", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    await prisma.paymentReminderLog.create({
      data: { eventId: "evt-1", userId: "user-1", sentAt: yesterday },
    });
    const result = await shouldSendPaymentReminder("evt-1", "user-1");
    expect(result).toBe(true);
  });
});

// ── markPaymentReminderSent ───────────────────────────────────────────────────

describe("markPaymentReminderSent", () => {
  it("creates a log entry", async () => {
    await markPaymentReminderSent("evt-1", "user-1");
    const logs = await prisma.paymentReminderLog.findMany({
      where: { eventId: "evt-1", userId: "user-1" },
    });
    expect(logs.length).toBe(1);
  });
});

// ── wantsPaymentReminderEmail ─────────────────────────────────────────────────

describe("wantsPaymentReminderEmail", () => {
  it("returns true with default prefs", () => {
    const prefs = {
      emailEnabled: true,
      pushEnabled: true,
      gameInviteEmail: true,
      gameInvitePush: true,
      gameReminderEmail: true,
      gameReminderPush: true,
      weeklySummaryEmail: false,
      paymentReminderEmail: true,
      paymentReminderPush: true,
      reminder24h: true,
      reminder2h: true,
      reminder1h: false,
    };
    expect(wantsPaymentReminderEmail(prefs)).toBe(true);
  });

  it("returns false when emailEnabled is false", () => {
    const prefs = {
      emailEnabled: false,
      pushEnabled: true,
      gameInviteEmail: true,
      gameInvitePush: true,
      gameReminderEmail: true,
      gameReminderPush: true,
      weeklySummaryEmail: false,
      paymentReminderEmail: true,
      paymentReminderPush: true,
      reminder24h: true,
      reminder2h: true,
      reminder1h: false,
    };
    expect(wantsPaymentReminderEmail(prefs)).toBe(false);
  });

  it("returns false when paymentReminderEmail is false", () => {
    const prefs = {
      emailEnabled: true,
      pushEnabled: true,
      gameInviteEmail: true,
      gameInvitePush: true,
      gameReminderEmail: true,
      gameReminderPush: true,
      weeklySummaryEmail: false,
      paymentReminderEmail: false,
      paymentReminderPush: true,
      reminder24h: true,
      reminder2h: true,
      reminder1h: false,
    };
    expect(wantsPaymentReminderEmail(prefs)).toBe(false);
  });
});
