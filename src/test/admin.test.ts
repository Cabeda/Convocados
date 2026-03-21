import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { prisma } from "~/lib/db.server";

async function seedUser(id: string, email = `${id}@test.com`) {
  await prisma.user.upsert({
    where: { id },
    update: { email },
    create: { id, name: `User ${id}`, email, emailVerified: true, role: "user", createdAt: new Date(), updatedAt: new Date() },
  });
}

async function seedEvent(id: string, ownerId: string, overrides: Record<string, unknown> = {}) {
  await prisma.event.upsert({
    where: { id },
    update: {},
    create: {
      id,
      title: "Admin Test Game",
      location: "Field",
      dateTime: new Date(Date.now() + 86400000), // tomorrow
      maxPlayers: 10,
      ownerId,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    },
  });
}

async function seedGameHistory(eventId: string, status = "played", dateTime = new Date()) {
  await prisma.gameHistory.create({
    data: {
      eventId,
      dateTime,
      status,
      teamOneName: "A",
      teamTwoName: "B",
      editableUntil: new Date(Date.now() + 86400000),
    },
  });
}

beforeEach(async () => {
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isAdmin", () => {
  it("returns true when user email matches ADMIN_EMAIL env var", async () => {
    process.env.ADMIN_EMAIL = "admin@test.com";
    await seedUser("admin-1", "admin@test.com");

    // Re-import to pick up env change
    const { isAdmin } = await import("~/lib/admin.server");
    expect(await isAdmin("admin-1")).toBe(true);

    delete process.env.ADMIN_EMAIL;
  });

  it("returns false when ADMIN_EMAIL is not set", async () => {
    delete process.env.ADMIN_EMAIL;
    await seedUser("user-1", "user@test.com");

    const { isAdmin } = await import("~/lib/admin.server");
    expect(await isAdmin("user-1")).toBe(false);
  });

  it("returns false when user email does not match ADMIN_EMAIL", async () => {
    process.env.ADMIN_EMAIL = "admin@test.com";
    await seedUser("user-1", "other@test.com");

    const { isAdmin } = await import("~/lib/admin.server");
    expect(await isAdmin("user-1")).toBe(false);

    delete process.env.ADMIN_EMAIL;
  });

  it("returns false for non-existent users", async () => {
    process.env.ADMIN_EMAIL = "admin@test.com";

    const { isAdmin } = await import("~/lib/admin.server");
    expect(await isAdmin("nonexistent")).toBe(false);

    delete process.env.ADMIN_EMAIL;
  });

  it("supports multiple comma-separated admin emails", async () => {
    process.env.ADMIN_EMAIL = "admin1@test.com, admin2@test.com, admin3@test.com";
    await seedUser("a1", "admin1@test.com");
    await seedUser("a2", "admin2@test.com");
    await seedUser("a3", "admin3@test.com");
    await seedUser("u1", "regular@test.com");

    const { isAdmin } = await import("~/lib/admin.server");
    expect(await isAdmin("a1")).toBe(true);
    expect(await isAdmin("a2")).toBe(true);
    expect(await isAdmin("a3")).toBe(true);
    expect(await isAdmin("u1")).toBe(false);

    delete process.env.ADMIN_EMAIL;
  });

  it("is case-insensitive for email matching", async () => {
    process.env.ADMIN_EMAIL = "Admin@Test.COM";
    await seedUser("a1", "admin@test.com");

    const { isAdmin } = await import("~/lib/admin.server");
    expect(await isAdmin("a1")).toBe(true);

    delete process.env.ADMIN_EMAIL;
  });
});

describe("isAdminByEmail", () => {
  it("returns true for an email in the admin list", async () => {
    process.env.ADMIN_EMAIL = "admin@test.com";

    const { isAdminByEmail } = await import("~/lib/admin.server");
    expect(await isAdminByEmail("admin@test.com")).toBe(true);

    delete process.env.ADMIN_EMAIL;
  });

  it("returns false when email is not in the admin list", async () => {
    process.env.ADMIN_EMAIL = "admin@test.com";

    const { isAdminByEmail } = await import("~/lib/admin.server");
    expect(await isAdminByEmail("other@test.com")).toBe(false);

    delete process.env.ADMIN_EMAIL;
  });

  it("is case-insensitive", async () => {
    process.env.ADMIN_EMAIL = "Admin@Test.COM";

    const { isAdminByEmail } = await import("~/lib/admin.server");
    expect(await isAdminByEmail("ADMIN@TEST.COM")).toBe(true);

    delete process.env.ADMIN_EMAIL;
  });
});

describe("getAdminStats", () => {
  it("returns comprehensive stats", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedEvent("e1", "u1", { sport: "football-5v5", isRecurring: true });
    await seedEvent("e2", "u2", { sport: "padel", isRecurring: false });
    await seedGameHistory("e1", "played", new Date());
    await seedGameHistory("e1", "played", new Date(Date.now() - 2 * 86400000)); // 2 days ago

    // Add a player with userId to count as active user
    await prisma.player.create({
      data: { name: "Player 1", eventId: "e1", userId: "u1", createdAt: new Date() },
    });

    const { getAdminStats } = await import("~/lib/admin.server");
    const stats = await getAdminStats();

    expect(stats.totalUsers).toBe(2);
    expect(stats.totalEvents).toBe(2);
    expect(stats.totalGamesPlayed).toBe(2);
    expect(stats.activeEvents).toBe(2); // both are in the future
    expect(stats.activeUsers).toBe(1);
    expect(stats.gamesLast7d).toBe(2);
    expect(stats.gamesLast30d).toBe(2);
    expect(stats.recurringEvents).toBe(1);
    expect(stats.oneOffEvents).toBe(1);
    expect(stats.sportDistribution).toEqual({ "football-5v5": 1, padel: 1 });
  });

  it("returns zero counts when empty", async () => {
    const { getAdminStats } = await import("~/lib/admin.server");
    const stats = await getAdminStats();

    expect(stats.totalUsers).toBe(0);
    expect(stats.totalEvents).toBe(0);
    expect(stats.totalGamesPlayed).toBe(0);
    expect(stats.activeEvents).toBe(0);
    expect(stats.activeUsers).toBe(0);
    expect(stats.gamesLast7d).toBe(0);
    expect(stats.gamesLast30d).toBe(0);
    expect(stats.recurringEvents).toBe(0);
    expect(stats.oneOffEvents).toBe(0);
    expect(stats.sportDistribution).toEqual({});
  });
});

describe("listUsers", () => {
  it("returns paginated users", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedUser("u3");

    const { listUsers } = await import("~/lib/admin.server");
    const result = await listUsers({ page: 1, pageSize: 2 });
    expect(result.users).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it("filters by search query", async () => {
    await seedUser("u1");
    await seedUser("u2");

    const { listUsers } = await import("~/lib/admin.server");
    const result = await listUsers({ page: 1, pageSize: 10, search: "u1" });
    expect(result.users).toHaveLength(1);
    expect(result.users[0].id).toBe("u1");
  });
});

describe("getGrowthTimeline", () => {
  it("returns cumulative user and event counts per day", async () => {
    // Create users on different days
    const day1 = new Date("2025-01-01T10:00:00Z");
    const day2 = new Date("2025-01-02T10:00:00Z");
    const day3 = new Date("2025-01-03T10:00:00Z");

    await prisma.user.create({
      data: { id: "g-u1", name: "U1", email: "g1@test.com", emailVerified: true, role: "user", createdAt: day1, updatedAt: day1 },
    });
    await prisma.user.create({
      data: { id: "g-u2", name: "U2", email: "g2@test.com", emailVerified: true, role: "user", createdAt: day2, updatedAt: day2 },
    });
    await prisma.event.create({
      data: { id: "g-e1", title: "Game 1", location: "Field", dateTime: day3, maxPlayers: 10, ownerId: "g-u1", createdAt: day1, updatedAt: day1 },
    });
    await prisma.event.create({
      data: { id: "g-e2", title: "Game 2", location: "Field", dateTime: day3, maxPlayers: 10, ownerId: "g-u2", createdAt: day3, updatedAt: day3 },
    });

    const { getGrowthTimeline } = await import("~/lib/admin.server");
    const timeline = await getGrowthTimeline("all");

    expect(timeline).toHaveLength(3); // 3 distinct days
    expect(timeline[0]).toEqual({ date: "2025-01-01", users: 1, events: 1 });
    expect(timeline[1]).toEqual({ date: "2025-01-02", users: 2, events: 1 });
    expect(timeline[2]).toEqual({ date: "2025-01-03", users: 2, events: 2 });
  });

  it("returns empty array when no data exists", async () => {
    const { getGrowthTimeline } = await import("~/lib/admin.server");
    const timeline = await getGrowthTimeline("30d");

    expect(timeline).toEqual([]);
  });

  it("includes cumulative offset for windowed ranges", async () => {
    // Create a user well before the 30d window
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

    await prisma.user.create({
      data: { id: "g-old", name: "Old", email: "old@test.com", emailVerified: true, role: "user", createdAt: oldDate, updatedAt: oldDate },
    });
    await prisma.user.create({
      data: { id: "g-new", name: "New", email: "new@test.com", emailVerified: true, role: "user", createdAt: recentDate, updatedAt: recentDate },
    });

    const { getGrowthTimeline } = await import("~/lib/admin.server");
    const timeline = await getGrowthTimeline("30d");

    // Should have 1 entry (only the recent user is in the window)
    expect(timeline).toHaveLength(1);
    // But cumulative count should be 2 (1 offset + 1 in window)
    expect(timeline[0].users).toBe(2);
  });
});
