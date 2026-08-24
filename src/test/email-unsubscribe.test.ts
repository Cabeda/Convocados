import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Mock Resend before importing the modules under test
const mockSend = vi.fn();
vi.mock("resend", () => {
  class MockResend {
    emails = { send: mockSend };
  }
  return { Resend: MockResend };
});

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const testPrisma = new PrismaClient();

import {
  getOrCreateUnsubscribeToken,
  getOrCreateUnsubscribeTokenByEmail,
  validateUnsubscribeToken,
  applyUnsubscribe,
} from "~/lib/unsubscribe.server";

import { GET as unsubscribeGET, POST as unsubscribePOST } from "~/pages/api/unsubscribe";

import {
  _resetResendClient,
  sendGameInvite,
  sendReminder,
  sendPaymentReminder,
  sendWeeklySummary,
  sendVerificationEmail,
  sendMagicLinkEmail,
  sendChangeEmailVerification,
} from "~/lib/email.server";

function ctx(url: string, method: "GET" | "POST") {
  const request = new Request(url, { method });
  return { request, params: {} } as any;
}

async function seedUser(overrides: Record<string, unknown> = {}) {
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return testPrisma.user.create({
    data: {
      id,
      name: "Test User",
      email: `${id}@test.com`,
      emailVerified: true,
      ...overrides,
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  _resetResendClient();
  mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
  await testPrisma.notificationPreferences.deleteMany();
  await testPrisma.session.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.user.deleteMany();
});

// ─── Token lifecycle ─────────────────────────────────────────────────────────

describe("unsubscribe tokens", () => {
  it("creates a token and returns the same one on subsequent calls", async () => {
    const user = await seedUser();

    const first = await getOrCreateUnsubscribeToken(user.id);
    expect(first).toBeTruthy();
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    const second = await getOrCreateUnsubscribeToken(user.id);
    expect(second).toBe(first);
  });

  it("looks up or creates a token by email address", async () => {
    const user = await seedUser();

    const byEmail = await getOrCreateUnsubscribeTokenByEmail(user.email);
    expect(byEmail).toBe(await getOrCreateUnsubscribeToken(user.id));
  });

  it("returns null when no user exists for the email", async () => {
    expect(await getOrCreateUnsubscribeTokenByEmail("nobody@test.com")).toBeNull();
  });

  it("validates a known token and rejects unknown ones", async () => {
    const user = await seedUser();
    const token = await getOrCreateUnsubscribeToken(user.id);

    expect(await validateUnsubscribeToken(token)).toEqual({ userId: user.id });
    expect(await validateUnsubscribeToken(`not-${token}`)).toBeNull();
  });
});

// ─── Applying unsubscribes ───────────────────────────────────────────────────

describe("applyUnsubscribe", () => {
  it.each([
    ["gameInvite", { gameInviteEmail: false }],
    ["gameReminder", { gameReminderEmail: false }],
    ["weeklySummary", { weeklySummaryEmail: false }],
    ["paymentReminder", { paymentReminderEmail: false }],
  ] as const)("turns off %s email preference without touching others", async (type, expectedOff) => {
    const user = await seedUser();

    await applyUnsubscribe(user.id, type);

    const stored = await testPrisma.notificationPreferences.findUnique({ where: { userId: user.id } });
    expect(stored).not.toBeNull();
    // Only the targeted channel flips off…
    for (const [field, value] of Object.entries(expectedOff)) {
      expect((stored as any)[field]).toBe(value);
    }
    // …everything else keeps its defaults.
    expect(stored!.emailEnabled).toBe(false);
    expect(stored!.pushEnabled).toBe(true);
    expect(stored!.gameInvitePush).toBe(true);
    expect(stored!.gameReminderPush).toBe(true);
  });

  it("all turns off emailEnabled only", async () => {
    const user = await seedUser();
    await testPrisma.notificationPreferences.create({
      data: { userId: user.id, emailEnabled: true, gameInviteEmail: true, weeklySummaryEmail: true },
    });

    await applyUnsubscribe(user.id, "all");

    const stored = await testPrisma.notificationPreferences.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.emailEnabled).toBe(false);
    // Per-type flags stay untouched — re-enabling the master switch restores them.
    expect(stored.gameInviteEmail).toBe(true);
    expect(stored.weeklySummaryEmail).toBe(true);
  });

  it("is idempotent", async () => {
    const user = await seedUser();

    await applyUnsubscribe(user.id, "gameReminder");
    await applyUnsubscribe(user.id, "gameReminder");

    const stored = await testPrisma.notificationPreferences.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.gameReminderEmail).toBe(false);
  });
});

// ─── GET /api/unsubscribe ────────────────────────────────────────────────────

describe("GET /api/unsubscribe", () => {
  it("unsubscribes without login and shows a confirmation page", async () => {
    const user = await seedUser();
    await testPrisma.notificationPreferences.create({
      data: { userId: user.id, emailEnabled: true, gameReminderEmail: true },
    });
    const token = await getOrCreateUnsubscribeToken(user.id);

    const res = await unsubscribeGET(ctx(`http://localhost/api/unsubscribe?token=${token}&type=gameReminder`, "GET"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("preferences");

    const stored = await testPrisma.notificationPreferences.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.gameReminderEmail).toBe(false);
    expect(stored.emailEnabled).toBe(true);
  });

  it("returns 404 for an unknown token", async () => {
    const res = await unsubscribeGET(
      ctx(`http://localhost/api/unsubscribe?token=${"0".repeat(64)}&type=all`, "GET"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when the type is unknown", async () => {
    const user = await seedUser();
    const token = await getOrCreateUnsubscribeToken(user.id);

    const res = await unsubscribeGET(ctx(`http://localhost/api/unsubscribe?token=${token}&type=bogus`, "GET"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the token is missing", async () => {
    const res = await unsubscribeGET(ctx(`http://localhost/api/unsubscribe?type=all`, "GET"));
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/unsubscribe (RFC 8058 one-click) ──────────────────────────────

describe("POST /api/unsubscribe", () => {
  it("applies the unsubscribe for one-click senders", async () => {
    const user = await seedUser();
    const token = await getOrCreateUnsubscribeToken(user.id);

    const res = await unsubscribePOST(ctx(`http://localhost/api/unsubscribe?token=${token}&type=weeklySummary`, "POST"));

    expect(res.status).toBe(200);
    const stored = await testPrisma.notificationPreferences.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.weeklySummaryEmail).toBe(false);
  });
});

// ─── Email footers ───────────────────────────────────────────────────────────

describe("email footer links", () => {
  it("preference-based emails include a tokenized one-click unsubscribe link", async () => {
    const user = await seedUser();
    const token = await getOrCreateUnsubscribeToken(user.id);

    const cases = [
      [() => sendGameInvite(user.email, { eventTitle: "Futsal", dateTime: new Date().toISOString(), location: "Gym", eventUrl: "http://x/e" }), "gameInvite"],
      [() => sendReminder(user.email, { eventTitle: "Futsal", dateTime: new Date().toISOString(), location: "Gym", spotsLeft: 2, eventUrl: "http://x/e", reminderType: "24h" }), "gameReminder"],
      [() => sendPaymentReminder(user.email, { eventTitle: "Futsal", amount: "5", currency: "EUR", eventUrl: "http://x/e" }), "paymentReminder"],
      [() => sendWeeklySummary(user.email, { userName: "T", upcoming: [], results: [], dashboardUrl: "http://x/d" }), "weeklySummary"],
    ] as const;

    for (const [send, type] of cases) {
      mockSend.mockClear();
      await (send as any)();
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain(`/api/unsubscribe?token=${token}&type=${type}`);
      expect(call.html).toContain("/settings/notifications");
      expect(call.headers["List-Unsubscribe"]).toContain(`/api/unsubscribe?token=${token}&type=${type}`);
      expect(call.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    }
  });

  it("emails without a matching preference offer unsubscribe-from-all instead", async () => {
    const user = await seedUser();
    const token = await getOrCreateUnsubscribeToken(user.id);

    const { sendPlayerJoinedOwnerNotification } = await import("~/lib/email.server");
    await sendPlayerJoinedOwnerNotification(user.email, {
      eventTitle: "Futsal", playerName: "Ana", spotsLeft: 1, eventUrl: "http://x/e",
    });

    const call = mockSend.mock.calls[0][0];
    expect(call.html).toContain(`/api/unsubscribe?token=${token}&type=all`);
  });

  it("transactional emails link to preferences but never include an unsubscribe link", async () => {
    const user = await seedUser();
    await getOrCreateUnsubscribeToken(user.id);

    await sendVerificationEmail(user.email, "http://x/verify");
    await sendMagicLinkEmail(user.email, "http://x/magic");
    await sendChangeEmailVerification(user.email, "http://x/change");

    for (const [payload] of mockSend.mock.calls) {
      expect(payload.html).toContain("/settings/notifications");
      expect(payload.html).not.toContain("/api/unsubscribe");
    }
  });

  it("falls back gracefully when the recipient is not a registered user", async () => {
    await sendGameInvite("stranger@example.com", {
      eventTitle: "Futsal", dateTime: new Date().toISOString(), location: "Gym", eventUrl: "http://x/e",
    });

    const call = mockSend.mock.calls[0][0];
    expect(call.html).toContain("/settings/notifications");
    expect(call.html).not.toContain("/api/unsubscribe?token=");
  });
});
