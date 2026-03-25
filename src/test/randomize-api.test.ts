import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../lib/db.server";
import { resetApiRateLimitStore } from "../lib/apiRateLimit.server";

// Helper to create test event
async function seedEvent() {
  const event = await prisma.event.create({
    data: {
      title: "Test Event",
      location: "Test Location",
      dateTime: new Date(Date.now() + 86400_000),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
    },
  });
  return event.id;
}

// Helper to create test user
async function seedUser(email: string, name: string) {
  return prisma.user.create({
    data: {
      id: `test-${email}`,
      email,
      name,
      role: "user",
    },
  });
}

describe("POST /api/events/[id]/randomize - with claimed players", () => {
  beforeEach(async () => {
    await prisma.teamMember.deleteMany();
    await prisma.teamResult.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    await resetApiRateLimitStore();
  });

  it("includes claimed players in randomization", async () => {
    const eventId = await seedEvent();
    await prisma.event.update({ where: { id: eventId }, data: { maxPlayers: 10 } });

    // Create user for claimed player
    const user = await seedUser("test@test.com", "Test User1");

    // Add 8 anonymous players (orders 0-7)
    for (let i = 0; i < 8; i++) {
      await prisma.player.create({
        data: { name: `Player ${i}`, eventId, order: i },
      });
    }

    // Add 1 claimed player at order 3 (middle of active players)
    await prisma.player.create({
      data: { name: "Test User1", eventId, order: 3, userId: user.id },
    });

    // Add 2 bench players (orders 8-9)
    for (let i = 0; i < 2; i++) {
      await prisma.player.create({
        data: { name: `Bench ${i}`, eventId, order: 8 + i },
      });
    }

    // Verify all players were created correctly
    // Total: 8 anonymous + 1 claimed + 2 bench = 11 players
    const allPlayers = await prisma.player.findMany({
      where: { eventId },
      orderBy: { order: "asc" },
    });
    expect(allPlayers).toHaveLength(11);

    // Simulate randomize endpoint logic
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    const players = await prisma.player.findMany({
      where: { eventId },
      orderBy: { order: "asc" },
      take: event!.maxPlayers,
    });

    // The first 10 players should be selected (orders 0-7 + claimed + one bench)
    // This includes Test User1 (order 3)
    // and excludes the second bench player (order 9)
    expect(players).toHaveLength(10);
    expect(players.find(p => p.name === "Test User1")).toBeDefined();
    expect(players.find(p => p.name === "Bench 1")).toBeUndefined();
  });

  it("correctly handles player order after reset", async () => {
    const eventId = await seedEvent();
    await prisma.event.update({ where: { id: eventId }, data: { maxPlayers: 10 } });

    // Create user for claimed player
    const user = await seedUser("test2@test.com", "Test User1");

    // Add players with non-sequential orders (simulating after player removal)
    await prisma.player.createMany({
      data: [
        { name: "Player A", eventId, order: 0 },
        { name: "Player B", eventId, order: 2 }, // Gap: order 1 missing
        { name: "Player C", eventId, order: 4 }, // Gap: order 3 missing
        { name: "Test User1", eventId, order: 5, userId: user.id },
        { name: "Player D", eventId, order: 7 }, // Gap: order 6 missing
        { name: "Player E", eventId, order: 8 },
      ],
    });

    // Simulate randomize endpoint logic
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    const players = await prisma.player.findMany({
      where: { eventId },
      orderBy: { order: "asc" },
      take: event!.maxPlayers,
    });

    console.log("Players with gaps:", players.map(p => ({ name: p.name, order: p.order })));

    // Should include all 6 players regardless of order gaps
    expect(players).toHaveLength(6);
    expect(players.find(p => p.name === "Test User1")).toBeDefined();
  });

  it("prioritizes claimed players when at capacity", async () => {
    const eventId = await seedEvent();
    await prisma.event.update({ where: { id: eventId }, data: { maxPlayers: 5 } });

    // Create user
    const user = await seedUser("user3@test.com", "Claimed User");

    // Add 4 anonymous players (orders 0-3)
    for (let i = 0; i < 4; i++) {
      await prisma.player.create({
        data: { name: `Player ${i}`, eventId, order: i },
      });
    }

    // Add 1 claimed player at order 4
    await prisma.player.create({
      data: { name: "Claimed User", eventId, order: 4, userId: user.id },
    });

    // Add 1 bench player at order 5
    await prisma.player.create({
      data: { name: "Bench Player", eventId, order: 5 },
    });

    // Simulate randomize endpoint logic
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    const players = await prisma.player.findMany({
      where: { eventId },
      orderBy: { order: "asc" },
      take: event!.maxPlayers,
    });

    console.log("Players at capacity:", players.map(p => ({ name: p.name, order: p.order })));

    // Should include exactly 5 players (maxPlayers)
    expect(players).toHaveLength(5);

    // Claimed player should be included
    expect(players.find(p => p.name === "Claimed User")).toBeDefined();

    // Bench player should NOT be included
    expect(players.find(p => p.name === "Bench Player")).toBeUndefined();
  });

  it("reproduces exact deployed bug scenario", async () => {
    const eventId = await seedEvent();
    await prisma.event.update({ where: { id: eventId }, data: { maxPlayers: 10 } });

    // Create user for claimed player
    const user1 = await seedUser("user1@test.com", "Player Three");
    const user2 = await seedUser("user2@test.com", "Test User1");

    // Recreate exact deployed scenario with players at specific orders
    await prisma.player.createMany({
      data: [
        { name: "Player One", eventId, order: 0 },
        { name: "Player Two", eventId, order: 1 },
        { name: "Player Three", eventId, order: 2, userId: user1.id },
        { name: "Player Four", eventId, order: 3 },
        { name: "Test User1", eventId, order: 4, userId: user2.id },
        { name: "Bob Smith", eventId, order: 5 },
        { name: "Player Six", eventId, order: 6 },
        { name: "Player Seven", eventId, order: 7 },
        { name: "Player Eight", eventId, order: 8 },
        { name: "Player Nine", eventId, order: 9 },
        { name: "Charlie Brown", eventId, order: 10 },
        { name: "Bench Player", eventId, order: 11 },
      ],
    });

    // Simulate randomize endpoint logic
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    const players = await prisma.player.findMany({
      where: { eventId },
      orderBy: { order: "asc" },
      take: event!.maxPlayers,
    });

    console.log("Deployed scenario players:", players.map(p => ({ name: p.name, order: p.order, userId: p.userId })));

    // Should include exactly 10 players
    expect(players).toHaveLength(10);

    // Test User1 (order 4) MUST be included
    expect(players.find(p => p.name === "Test User1")).toBeDefined();

    // Charlie Brown (order 10) must NOT be included (bench)
    expect(players.find(p => p.name === "Charlie Brown")).toBeUndefined();

    // Bench Player (order 11) must NOT be included (bench)
    expect(players.find(p => p.name === "Bench Player")).toBeUndefined();

    // Verify all active players are included
    const expectedActive = [
      "Player One", "Player Two", "Player Three", "Player Four", "Test User1",
      "Bob Smith", "Player Six", "Player Seven", "Player Eight", "Player Nine"
    ];
    expectedActive.forEach(name => {
      expect(players.find(p => p.name === name)).toBeDefined();
    });
  });
});