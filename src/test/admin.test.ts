import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { isAdmin, getAdminStats, listUsers } from "~/lib/admin.server";

async function seedUser(id: string, role = "user") {
  await prisma.user.upsert({
    where: { id },
    update: { role },
    create: { id, name: `User ${id}`, email: `${id}@test.com`, emailVerified: true, role, createdAt: new Date(), updatedAt: new Date() },
  });
}

async function seedEvent(id: string, ownerId: string) {
  await prisma.event.upsert({
    where: { id },
    update: {},
    create: { id, title: "Admin Test Game", location: "Field", dateTime: new Date(), maxPlayers: 10, ownerId, createdAt: new Date(), updatedAt: new Date() },
  });
}

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

describe("isAdmin", () => {
  it("returns true for admin users", async () => {
    await seedUser("admin-1", "admin");
    expect(await isAdmin("admin-1")).toBe(true);
  });

  it("returns false for regular users", async () => {
    await seedUser("user-1", "user");
    expect(await isAdmin("user-1")).toBe(false);
  });

  it("returns false for non-existent users", async () => {
    expect(await isAdmin("nonexistent")).toBe(false);
  });
});

describe("getAdminStats", () => {
  it("returns user and event counts", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedEvent("e1", "u1");

    const stats = await getAdminStats();
    expect(stats.totalUsers).toBe(2);
    expect(stats.totalEvents).toBe(1);
  });

  it("returns zero counts when empty", async () => {
    const stats = await getAdminStats();
    expect(stats.totalUsers).toBe(0);
    expect(stats.totalEvents).toBe(0);
  });
});

describe("listUsers", () => {
  it("returns paginated users", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedUser("u3");

    const result = await listUsers({ page: 1, pageSize: 2 });
    expect(result.users).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it("filters by search query", async () => {
    await seedUser("u1");
    await seedUser("u2");

    const result = await listUsers({ page: 1, pageSize: 10, search: "u1" });
    expect(result.users).toHaveLength(1);
    expect(result.users[0].id).toBe("u1");
  });
});
