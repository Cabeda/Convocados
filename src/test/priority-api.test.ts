import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Mock auth helpers
const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: async (request: Request, ownerId: string | null, existingSession?: any) => {
    const session = existingSession ?? await mockGetSession(request);
    const isOwner = !!(session?.user && ownerId && session.user.id === ownerId);
    return { isOwner, session };
  },
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

// Mock rate limiting to always allow
vi.mock("~/lib/apiRateLimit.server", () => ({
  rateLimitResponse: vi.fn().mockResolvedValue(null),
  resetApiRateLimitStore: vi.fn(),
}));

// Import route handlers AFTER mocking
import { GET as getPriority, PUT as putPriority } from "~/pages/api/events/[id]/priority/index";
import { POST as addPriorityPlayer, DELETE as removePriorityPlayer } from "~/pages/api/events/[id]/priority/[userId]";
import { PUT as optOutPriority } from "~/pages/api/events/[id]/priority/opt-out";
import { PUT as optInPriority } from "~/pages/api/events/[id]/priority/opt-in";
import { POST as confirmPriority } from "~/pages/api/events/[id]/priority/confirm";
import { POST as declinePriority } from "~/pages/api/events/[id]/priority/decline";

// ── Helpers ──────────────────────────────────────────────────────────────────

function ctx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

function putCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

function deleteCtx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", { method: "DELETE" });
  return { request, params } as any;
}

async function seedUser(overrides: Record<string, unknown> = {}) {
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return testPrisma.user.create({
    data: {
      id,
      name: overrides.name as string ?? "Test User",
      email: `${id}@test.com`,
      emailVerified: false,
      ...overrides,
    },
  });
}

async function seedEvent(ownerId: string, overrides: Record<string, unknown> = {}) {
  return testPrisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 7 * 86400_000),
      ownerId,
      ...overrides,
    },
  });
}

async function seedGameHistory(eventId: string, playerNames: string[], dateTime: Date) {
  const teams = [
    { team: "A", players: playerNames.slice(0, Math.ceil(playerNames.length / 2)).map((n, i) => ({ name: n, order: i })) },
    { team: "B", players: playerNames.slice(Math.ceil(playerNames.length / 2)).map((n, i) => ({ name: n, order: i })) },
  ];
  return testPrisma.gameHistory.create({
    data: {
      eventId,
      dateTime,
      teamOneName: "A",
      teamTwoName: "B",
      teamsSnapshot: JSON.stringify(teams),
      editableUntil: new Date(dateTime.getTime() + 7 * 86400_000),
      status: "played",
    },
  });
}

function mockAuth(userId: string) {
  mockGetSession.mockResolvedValue({ user: { id: userId, name: "Test User" }, session: { id: "s1" } });
}

function mockNoAuth() {
  mockGetSession.mockResolvedValue(null);
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  mockGetSession.mockReset();
  await testPrisma.priorityConfirmation.deleteMany();
  await testPrisma.priorityEnrollment.deleteMany();
  await testPrisma.gameHistory.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.session.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.user.deleteMany();
});

// ─── GET /api/events/:id/priority ────────────────────────────────────────────

describe("GET /api/events/:id/priority", () => {
  it("returns priority settings and empty enrollments", async () => {
    const owner = await seedUser();
    const event = await seedEvent(owner.id);

    const res = await getPriority(ctx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.priorityEnabled).toBe(false);
    expect(body.settings.priorityThreshold).toBe(3);
    expect(body.enrollments).toHaveLength(0);
    expect(body.eligible).toHaveLength(0);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await getPriority(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });
});

// ─── PUT /api/events/:id/priority ────────────────────────────────────────────

describe("PUT /api/events/:id/priority", () => {
  it("owner can enable priority enrollment", async () => {
    const owner = await seedUser();
    const event = await seedEvent(owner.id);
    mockAuth(owner.id);

    const res = await putPriority(putCtx({ id: event.id }, { priorityEnabled: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.priorityEnabled).toBe(true);
  });

  it("owner can update all settings", async () => {
    const owner = await seedUser();
    const event = await seedEvent(owner.id);
    mockAuth(owner.id);

    const res = await putPriority(putCtx({ id: event.id }, {
      priorityEnabled: true,
      priorityThreshold: 2,
      priorityWindow: 6,
      priorityMaxPercent: 50,
      priorityDeadlineHours: 24,
      priorityMinGames: 5,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.priorityThreshold).toBe(2);
    expect(body.settings.priorityWindow).toBe(6);
    expect(body.settings.priorityMaxPercent).toBe(50);
    expect(body.settings.priorityDeadlineHours).toBe(24);
    expect(body.settings.priorityMinGames).toBe(5);
  });

  it("rejects non-owner", async () => {
    const owner = await seedUser();
    const other = await seedUser({ name: "Other" });
    const event = await seedEvent(owner.id);
    mockAuth(other.id);

    const res = await putPriority(putCtx({ id: event.id }, { priorityEnabled: true }));
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated", async () => {
    const owner = await seedUser();
    const event = await seedEvent(owner.id);
    mockNoAuth();

    const res = await putPriority(putCtx({ id: event.id }, { priorityEnabled: true }));
    expect(res.status).toBe(403);
  });

  it("rejects invalid values", async () => {
    const owner = await seedUser();
    const event = await seedEvent(owner.id);
    mockAuth(owner.id);

    const res = await putPriority(putCtx({ id: event.id }, { priorityThreshold: -1 }));
    expect(res.status).toBe(400);
  });
});

// ─── POST/DELETE /api/events/:id/priority/:userId ────────────────────────────

describe("POST /api/events/:id/priority/:userId", () => {
  it("owner can manually add a player", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Player" });
    const event = await seedEvent(owner.id, { priorityEnabled: true });
    mockAuth(owner.id);

    const res = await addPriorityPlayer(ctx({ id: event.id, userId: player.id }, {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollment.source).toBe("manual");
  });

  it("rejects non-owner", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Player" });
    const event = await seedEvent(owner.id, { priorityEnabled: true });
    mockAuth(player.id);

    const res = await addPriorityPlayer(ctx({ id: event.id, userId: player.id }, {}));
    expect(res.status).toBe(403);
  });

  it("rejects when priority not enabled", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Player" });
    const event = await seedEvent(owner.id);
    mockAuth(owner.id);

    const res = await addPriorityPlayer(ctx({ id: event.id, userId: player.id }, {}));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/events/:id/priority/:userId", () => {
  it("owner can remove a player", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Player" });
    const event = await seedEvent(owner.id, { priorityEnabled: true });
    mockAuth(owner.id);

    // Add first
    await addPriorityPlayer(ctx({ id: event.id, userId: player.id }, {}));
    // Remove
    const res = await removePriorityPlayer(deleteCtx({ id: event.id, userId: player.id }));
    expect(res.status).toBe(200);
  });
});

// ─── Opt-in / Opt-out ────────────────────────────────────────────────────────

describe("PUT /api/events/:id/priority/opt-out", () => {
  it("player can opt out", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Player" });
    const event = await seedEvent(owner.id, { priorityEnabled: true });

    // Enroll player first
    await testPrisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: player.id, source: "auto", optedIn: true },
    });

    mockAuth(player.id);
    const res = await optOutPriority(putCtx({ id: event.id }, {}));
    expect(res.status).toBe(200);

    // Verify opted out
    const enrollment = await testPrisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: player.id } },
    });
    expect(enrollment!.optedIn).toBe(false);
  });

  it("returns 401 for unauthenticated", async () => {
    const owner = await seedUser();
    const event = await seedEvent(owner.id);
    mockNoAuth();

    const res = await optOutPriority(putCtx({ id: event.id }, {}));
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/events/:id/priority/opt-in", () => {
  it("player can opt back in", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Player" });
    const event = await seedEvent(owner.id, { priorityEnabled: true });

    // Enroll and opt out
    await testPrisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: player.id, source: "auto", optedIn: false, declineStreak: 2 },
    });

    mockAuth(player.id);
    const res = await optInPriority(putCtx({ id: event.id }, {}));
    expect(res.status).toBe(200);

    // Verify opted in and decline streak reset
    const enrollment = await testPrisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: player.id } },
    });
    expect(enrollment!.optedIn).toBe(true);
    expect(enrollment!.declineStreak).toBe(0);
  });
});

// ─── Confirm / Decline ───────────────────────────────────────────────────────

describe("POST /api/events/:id/priority/confirm", () => {
  it("player can confirm their spot", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Player" });
    const gameDate = new Date(Date.now() + 7 * 86400_000);
    const event = await seedEvent(owner.id, { priorityEnabled: true, dateTime: gameDate });

    // Create enrollment and pending confirmation
    await testPrisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: player.id, source: "auto" },
    });
    await testPrisma.priorityConfirmation.create({
      data: {
        eventId: event.id,
        userId: player.id,
        gameDate,
        status: "pending",
        notifiedAt: new Date(),
        deadline: new Date(gameDate.getTime() - 48 * 3600_000),
      },
    });

    mockAuth(player.id);
    mockGetSession.mockResolvedValue({ user: { id: player.id, name: "Player" }, session: { id: "s1" } });
    const res = await confirmPriority(ctx({ id: event.id }, {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("confirmed");

    // Verify player was added to event
    const eventPlayer = await testPrisma.player.findFirst({
      where: { eventId: event.id, userId: player.id },
    });
    expect(eventPlayer).not.toBeNull();
    expect(eventPlayer!.name).toBe("Player");
  });

  it("returns 401 for unauthenticated", async () => {
    const owner = await seedUser();
    const event = await seedEvent(owner.id);
    mockNoAuth();

    const res = await confirmPriority(ctx({ id: event.id }, {}));
    expect(res.status).toBe(401);
  });

  it("returns 404 when no pending confirmation", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Player" });
    const event = await seedEvent(owner.id);
    mockAuth(player.id);

    const res = await confirmPriority(ctx({ id: event.id }, {}));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/events/:id/priority/decline", () => {
  it("player can decline their spot", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Player" });
    const gameDate = new Date(Date.now() + 7 * 86400_000);
    const event = await seedEvent(owner.id, { priorityEnabled: true, dateTime: gameDate });

    await testPrisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: player.id, source: "auto" },
    });
    await testPrisma.priorityConfirmation.create({
      data: {
        eventId: event.id,
        userId: player.id,
        gameDate,
        status: "pending",
        notifiedAt: new Date(),
        deadline: new Date(gameDate.getTime() - 48 * 3600_000),
      },
    });

    mockAuth(player.id);
    const res = await declinePriority(ctx({ id: event.id }, {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("declined");

    // Verify decline streak incremented
    const enrollment = await testPrisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: player.id } },
    });
    expect(enrollment!.declineStreak).toBe(1);
  });
});

// ─── Eligibility preview ─────────────────────────────────────────────────────

describe("GET /api/events/:id/priority — eligibility", () => {
  it("shows eligible players based on attendance", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Alice" });
    const event = await seedEvent(owner.id, {
      priorityEnabled: true,
      priorityThreshold: 3,
      priorityWindow: 4,
      priorityMinGames: 3,
    });

    // Create 5 games where Alice played in all
    for (let i = 0; i < 5; i++) {
      await seedGameHistory(event.id, ["Alice", "Bob"], new Date(Date.now() - (5 - i) * 7 * 86400_000));
    }

    // Enroll Alice
    await testPrisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: player.id, source: "auto" },
    });

    const res = await getPriority(ctx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible.length).toBe(1);
    expect(body.eligible[0].name).toBe("Alice");
    expect(body.eligible[0].attendanceRate).toBe(1);
  });
});
