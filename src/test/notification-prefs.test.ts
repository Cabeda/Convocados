import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Mock auth helpers
const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

// Mock logger
vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Ensure route handlers use the same prisma client
vi.mock("~/lib/db.server", () => {
  const { PrismaClient: PC } = require("@prisma/client");
  const p = new PC({ datasources: { db: { url: process.env.DATABASE_URL } } });
  return { prisma: p };
});

// Import route handlers AFTER mocking
import { GET, PUT } from "~/pages/api/me/notification-preferences";

// Import helper functions (these don't need DB mocking — they use the mocked prisma)
import { wantsEmailReminder, wantsPushReminder, wantsGameInviteEmail, wantsWeeklySummary, type NotificationPrefs } from "~/lib/notificationPrefs.server";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCtx() {
  const request = new Request("http://localhost/api/me/notification-preferences", { method: "GET" });
  return { request, params: {} } as any;
}

function putCtx(body: unknown) {
  const request = new Request("http://localhost/api/me/notification-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: {} } as any;
}

function putCtxRaw(rawBody: string) {
  const request = new Request("http://localhost/api/me/notification-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: rawBody,
  });
  return { request, params: {} } as any;
}

async function seedUser(overrides: Record<string, unknown> = {}) {
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return testPrisma.user.create({
    data: {
      id,
      name: "Test User",
      email: `${id}@test.com`,
      emailVerified: false,
      ...overrides,
    },
  });
}

function mockAuth(userId: string) {
  mockGetSession.mockResolvedValue({
    user: { id: userId, name: "Test User", email: `${userId}@test.com` },
  });
}

function mockAnonymous() {
  mockGetSession.mockResolvedValue(null);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockAnonymous();
  await testPrisma.notificationPreferences.deleteMany();
  await testPrisma.session.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.user.deleteMany();
});

// ─── GET /api/me/notification-preferences ───────────────────────────────────

describe("GET /api/me/notification-preferences", () => {
  it("returns 401 for unauthenticated users", async () => {
    mockAnonymous();
    const res = await GET(getCtx());
    expect(res.status).toBe(401);
  });

  it("returns defaults when no preferences are stored", async () => {
    const user = await seedUser();
    mockAuth(user.id);

    const res = await GET(getCtx());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.userId).toBe(user.id);
    expect(body.emailEnabled).toBe(false);
    expect(body.pushEnabled).toBe(true);
    expect(body.gameInviteEmail).toBe(false);
    expect(body.gameReminderEmail).toBe(false);
    expect(body.weeklySummaryEmail).toBe(false);
    expect(body.reminder24h).toBe(true);
    expect(body.reminder2h).toBe(true);
    expect(body.reminder1h).toBe(false);
  });

  it("returns stored preferences when they exist", async () => {
    const user = await seedUser();
    mockAuth(user.id);

    await testPrisma.notificationPreferences.create({
      data: {
        userId: user.id,
        emailEnabled: false,
        pushEnabled: true,
        gameInviteEmail: false,
        gameInvitePush: true,
        gameReminderEmail: false,
        gameReminderPush: true,
        weeklySummaryEmail: true,
        reminder24h: false,
        reminder2h: true,
        reminder1h: true,
      },
    });

    const res = await GET(getCtx());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.emailEnabled).toBe(false);
    expect(body.gameInviteEmail).toBe(false);
    expect(body.weeklySummaryEmail).toBe(true);
    expect(body.reminder1h).toBe(true);
  });
});

// ─── PUT /api/me/notification-preferences ───────────────────────────────────

describe("PUT /api/me/notification-preferences", () => {
  it("returns 401 for unauthenticated users", async () => {
    mockAnonymous();
    const res = await PUT(putCtx({ emailEnabled: false }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    const user = await seedUser();
    mockAuth(user.id);

    const res = await PUT(putCtxRaw("not json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("returns 400 when no valid fields provided", async () => {
    const user = await seedUser();
    mockAuth(user.id);

    const res = await PUT(putCtx({ unknownField: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No valid fields");
  });

  it("returns 400 when field value is not boolean", async () => {
    const user = await seedUser();
    mockAuth(user.id);

    const res = await PUT(putCtx({ emailEnabled: "yes" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("must be a boolean");
  });

  it("creates preferences on first update (upsert)", async () => {
    const user = await seedUser();
    mockAuth(user.id);

    const res = await PUT(putCtx({ emailEnabled: false, weeklySummaryEmail: true }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.emailEnabled).toBe(false);
    expect(body.weeklySummaryEmail).toBe(true);
    // Other fields should be defaults
    expect(body.pushEnabled).toBe(true);
    expect(body.gameReminderEmail).toBe(false);
  });

  it("updates existing preferences (partial update)", async () => {
    const user = await seedUser();
    mockAuth(user.id);

    // Create initial prefs
    await testPrisma.notificationPreferences.create({
      data: {
        userId: user.id,
        emailEnabled: true,
        pushEnabled: true,
        gameInviteEmail: true,
        gameInvitePush: true,
        gameReminderEmail: true,
        gameReminderPush: true,
        weeklySummaryEmail: false,
        reminder24h: true,
        reminder2h: true,
        reminder1h: false,
      },
    });

    // Update only one field
    const res = await PUT(putCtx({ reminder1h: true }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.reminder1h).toBe(true);
    // Other fields unchanged
    expect(body.emailEnabled).toBe(true);
    expect(body.weeklySummaryEmail).toBe(false);
  });
});

// ─── Helper functions (pure logic) ─────────────────────────────────────────

describe("notificationPrefs helpers", () => {
  const allEnabled: NotificationPrefs = {
    emailEnabled: true,
    pushEnabled: true,
    gameInviteEmail: true,
    gameInvitePush: true,
    gameReminderEmail: true,
    gameReminderPush: true,
    playerActivityPush: true,
    eventDetailsPush: true,
    weeklySummaryEmail: true,
    paymentReminderEmail: true,
    paymentReminderPush: true,
    reminder24h: true,
    reminder2h: true,
    reminder1h: true,
  };

  const allDisabled: NotificationPrefs = {
    emailEnabled: false,
    pushEnabled: false,
    gameInviteEmail: false,
    gameInvitePush: false,
    gameReminderEmail: false,
    gameReminderPush: false,
    playerActivityPush: false,
    eventDetailsPush: false,
    weeklySummaryEmail: false,
    paymentReminderEmail: false,
    paymentReminderPush: false,
    reminder24h: false,
    reminder2h: false,
    reminder1h: false,
  };

  describe("wantsEmailReminder", () => {
    it("returns true when all relevant flags are enabled", () => {
      expect(wantsEmailReminder(allEnabled, "24h")).toBe(true);
      expect(wantsEmailReminder(allEnabled, "2h")).toBe(true);
      expect(wantsEmailReminder(allEnabled, "1h")).toBe(true);
    });

    it("returns false when emailEnabled is off", () => {
      const prefs = { ...allEnabled, emailEnabled: false };
      expect(wantsEmailReminder(prefs, "24h")).toBe(false);
    });

    it("returns false when gameReminderEmail is off", () => {
      const prefs = { ...allEnabled, gameReminderEmail: false };
      expect(wantsEmailReminder(prefs, "24h")).toBe(false);
    });

    it("returns false when specific reminder type is off", () => {
      const prefs = { ...allEnabled, reminder24h: false };
      expect(wantsEmailReminder(prefs, "24h")).toBe(false);
      expect(wantsEmailReminder(prefs, "2h")).toBe(true);
    });
  });

  describe("wantsPushReminder", () => {
    it("returns true when all relevant flags are enabled", () => {
      expect(wantsPushReminder(allEnabled, "24h")).toBe(true);
    });

    it("returns false when pushEnabled is off", () => {
      const prefs = { ...allEnabled, pushEnabled: false };
      expect(wantsPushReminder(prefs, "24h")).toBe(false);
    });

    it("returns false when gameReminderPush is off", () => {
      const prefs = { ...allEnabled, gameReminderPush: false };
      expect(wantsPushReminder(prefs, "2h")).toBe(false);
    });
  });

  describe("wantsGameInviteEmail", () => {
    it("returns true when both flags are on", () => {
      expect(wantsGameInviteEmail(allEnabled)).toBe(true);
    });

    it("returns false when emailEnabled is off", () => {
      expect(wantsGameInviteEmail({ ...allEnabled, emailEnabled: false })).toBe(false);
    });

    it("returns false when gameInviteEmail is off", () => {
      expect(wantsGameInviteEmail({ ...allEnabled, gameInviteEmail: false })).toBe(false);
    });
  });

  describe("wantsWeeklySummary", () => {
    it("returns true when both flags are on", () => {
      expect(wantsWeeklySummary(allEnabled)).toBe(true);
    });

    it("returns false when emailEnabled is off", () => {
      expect(wantsWeeklySummary({ ...allEnabled, emailEnabled: false })).toBe(false);
    });

    it("returns false when weeklySummaryEmail is off (default)", () => {
      expect(wantsWeeklySummary(allDisabled)).toBe(false);
    });
  });
});
