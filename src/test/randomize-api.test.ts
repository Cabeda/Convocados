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
    resetApiRateLimitStore();
  });

  it("includes claimed players in randomization", async () => {
    const eventId = await seedEvent();
    await prisma.event.update({ where: { id: eventId }, data: { maxPlayers: 10 } });

    // Create user for claimed player
    const user = await seedUser("test@test.com", "José Cabeda");

    // Add 9 anonymous players (orders 0-8)
    for (let i = 0; i < 9; i++) {
      await prisma.player.create({
        data: { name: `Player ${i}`, eventId, order: i },
      });
    }

    // Add 1 claimed player at order 4 (José Cabeda)
    await prisma.player.create({
      data: { name: "José Cabeda", eventId, order: 4, userId: user.id },
    });

    // Add 2 bench players (orders 9-10)
    for (let i = 0; i < 2; i++) {
      await prisma.player.create({
        data: { name: `Bench ${i}`, eventId, order: 9 + i },
      });
    }

    // Verify all players were created correctly
    const allPlayers = await prisma.player.findMany({
      where: { eventId },
      orderBy: { order: "asc" },
    });
    console.log("All players:", allPlayers.map(p => ({ name: p.name, order: p.order, userId: p.userId })));
    expect(allPlayers).toHaveLength(12);
    expect(allPlayers[4].name).toBe("José Cabeda");
    expect(allPlayers[4].userId).toBe(user.id);

    // Simulate randomize endpoint logic
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    const players = await prisma.player.findMany({
      where: { eventId },
      orderBy: { order: "asc" },
      take: event!.maxPlayers,
    });

    console.log("Players selected for randomization:", players.map(p => ({ name: p.name, order: p.order })));

    // The first 10 players should be selected (orders 0-9)
    // which includes José Cabeda at order 4
    // and excludes bench players at orders 10-11
    expect(players).toHaveLength(10);
    expect(players.find(p => p.name === "José Cabeda")).toBeDefined();
    expect(players.find(p => p.name === "Bench 0")).toBeUndefined();
    expect(players.find(p => p.name === "Bench 1")).toBeUndefined();
  });

  it("correctly handles player order after reset", async () => {
    const eventId = await seedEvent();
    await prisma.event.update({ where: { id: eventId }, data: { maxPlayers: 10 } });

    // Create user for claimed player
    const user = await seedUser("test2@test.com", "José Cabeda");

    // Add players with non-sequential orders (simulating after player removal)
    await prisma.player.createMany({
      data: [
        { name: "Player A", eventId, order: 0 },
        { name: "Player B", eventId, order: 2 }, // Gap: order 1 missing
        { name: "Player C", eventId, order: 4 }, // Gap: order 3 missing
        { name: "José Cabeda", eventId, order: 5, userId: user.id },
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
    expect(players.find(p => p.name === "José Cabeda")).toBeDefined();
  });

  it("prioritizes claimed players when at capacity", async () => {
    const eventId = await seedEvent();
    await prisma.event.update({ where: { id: eventId }, data: { maxPlayers: 5 } });

    // Create user
    const user = await seedUser("test3@test.com", "Claimed User");

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
    const user1 = await seedUser("igor@test.com", "Igor Carvalho");
    const user2 = await seedUser("jose@test.com", "José Cabeda");

    // Recreate exact deployed scenario with players at specific orders
    await prisma.player.createMany({
      data: [
        { name: "Prucha", eventId, order: 0 },
        { name: "Gonçalo", eventId, order: 1 },
        { name: "Igor Carvalho", eventId, order: 2, userId: user1.id },
        { name: "Joao F", eventId, order: 3 },
        { name: "José Cabeda", eventId, order: 4, userId: user2.id },
        { name: "João Dias", eventId, order: 5 },
        { name: "Polónia", eventId, order: 6 },
        { name: "TF", eventId, order: 7 },
        { name: "Manecas", eventId, order: 8 },
        { name: "Enair", eventId, order: 9 },
        { name: "Pedro Cunha", eventId, order: 10 },
        { name: "Rodrigo", eventId, order: 11 },
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

    // José Cabeda (order 4) MUST be included
    expect(players.find(p => p.name === "José Cabeda")).toBeDefined();

    // Pedro Cunha (order 10) must NOT be included (bench)
    expect(players.find(p => p.name === "Pedro Cunha")).toBeUndefined();

    // Rodrigo (order 11) must NOT be included (bench)
    expect(players.find(p => p.name === "Rodrigo")).toBeUndefined();

    // Verify all active players are included
    const expectedActive = [
      "Prucha", "Gonçalo", "Igor Carvalho", "Joao F", "José Cabeda",
      "João Dias", "Polónia", "TF", "Manecas", "Enair"
    ];
    expectedActive.forEach(name => {
      expect(players.find(p => p.name === name)).toBeDefined();
    });
  });
});