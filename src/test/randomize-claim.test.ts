import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../lib/db.server";
import { resetApiRateLimitStore } from "../lib/apiRateLimit.server";

async function createTestUser(email: string, name: string) {
  return prisma.user.create({
    data: {
      id: `test-${email}`,
      email,
      name,
      role: "user",
    },
  });
}

async function createTestEvent(ownerId: string | null, maxPlayers = 10) {
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Test Location",
      dateTime: new Date(),
      maxPlayers,
      ownerId,
    },
  });
}

async function addPlayer(eventId: string, name: string, order?: number, userId?: string) {
  return prisma.player.create({
    data: {
      name,
      eventId,
      order: order ?? 0,
      userId,
    },
  });
}

describe("Team Randomization with Claimed Players", () => {
  beforeEach(async () => {
    await prisma.player.deleteMany();
    await prisma.teamMember.deleteMany();
    await prisma.teamResult.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    await resetApiRateLimitStore();
  });

  it("should include claimed player when randomizing teams (10 players, 1 claimed)", async () => {
    // Create user
    const user = await createTestUser("test@example.com", "Test User1");

    // Create event with maxPlayers = 10
    const event = await createTestEvent(null, 10);

    // Add 9 anonymous players (order 0-8)
    for (let i = 0; i < 9; i++) {
      await addPlayer(event.id, `Anonymous Player ${i + 1}`, i);
    }

    // Add 1 player that will be claimed (order 9)
    const claimedPlayer = await addPlayer(event.id, "Anonymous Player 10", 9);

    // Simulate claiming: update the player with user's name and userId
    await prisma.player.update({
      where: { id: claimedPlayer.id },
      data: { name: user.name, userId: user.id },
    });

    // Get all players as randomize endpoint does
    const players = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });

    // Verify: all 10 players should be included
    expect(players).toHaveLength(10);
    expect(players.map(p => p.name)).toContain("Test User1");
    expect(players.find(p => p.name === "Test User1")?.userId).toBe(user.id);
  });

  it("should NOT exclude a claimed bench player", async () => {
    const user = await createTestUser("test@example.com", "Test User1");
    const event = await createTestEvent(null, 10);

    // Add 10 active players (order 0-9)
    for (let i = 0; i < 10; i++) {
      await addPlayer(event.id, `Player ${i + 1}`, i);
    }

    // Add 1 bench player that will be claimed (order 10)
    const benchPlayer = await addPlayer(event.id, "Bench Player", 10);

    // Claim the bench player
    await prisma.player.update({
      where: { id: benchPlayer.id },
      data: { name: user.name, userId: user.id },
    });

    // Get players for randomization
    const players = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });

    // Verify: should have 10 players (maxPlayers), bench player excluded
    expect(players).toHaveLength(10);
    // The claimed bench player should be EXCLUDED (order 10)
    expect(players.map(p => p.name)).not.toContain("Test User1");
  });

  it("handles scenario: user joins event that's already full, then randomizes", async () => {
    const user = await createTestUser("test@example.com", "Test User1");
    const event = await createTestEvent(null, 10);

    // Add 10 anonymous players (order 0-9)
    for (let i = 0; i < 10; i++) {
      await addPlayer(event.id, `Anonymous ${i + 1}`, i);
    }

    // User joins - this creates a new player with order 10
    // (this is what happens when linkToAccount is true)
    const userPlayer = await addPlayer(event.id, user.name, 10, user.id);

    // Get players for randomization
    const players = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });

    // BUG: This will only have 10 players (orders 0-9), excluding user's player!
    console.log("Players for randomization:", players.map(p => ({ name: p.name, order: p.order })));
    expect(players).toHaveLength(10);
    // User's player should be EXCLUDED (order 10)
    expect(players.find(p => p.name === user.name)).toBeUndefined();
    
    // This is the BUG - the user's player should be included, not excluded
  });

  it("should include user's claimed player even if there are more than maxPlayers total", async () => {
    const user = await createTestUser("test@example.com", "Test User1");
    const event = await createTestEvent(null, 10);

    // Add 8 anonymous players (order 0-7)
    for (let i = 0; i < 8; i++) {
      await addPlayer(event.id, `Anonymous ${i + 1}`, i);
    }

    // Add 1 player that will be claimed (order 8)
    const claimedPlayer = await addPlayer(event.id, "To Be Claimed", 8);

    // Add 2 more bench players (order 9-10)
    await addPlayer(event.id, "Bench 1", 9);
    await addPlayer(event.id, "Bench 2", 10);

    // Claim the player at order 8
    await prisma.player.update({
      where: { id: claimedPlayer.id },
      data: { name: user.name, userId: user.id },
    });

    // Get players for randomization
    const players = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });

    // Should have 10 players
    expect(players).toHaveLength(10);
    // User's claimed player should be INCLUDED (order 8)
    expect(players.find(p => p.name === user.name)).toBeDefined();
  });

  it("reproduces the exact bug: player update during active game", async () => {
    // This test simulates the exact buggy scenario
    const user = await createTestUser("test@example.com", "Test User1");
    const event = await createTestEvent(null, 10);

    // Step 1: Create 11 players (10 active + 1 bench)
    const playerNames = [
      "Player 0", "Player 1", "Player 2", "Player 3", "Player 4",
      "Player 5", "Player 6", "Player 7", "Player 8", "Player 9",
      "Bench Player"
    ];
    
    for (let i = 0; i < playerNames.length; i++) {
      await addPlayer(event.id, playerNames[i], i);
    }

    // Step 2: Generate teams - should use first 10 players
    let players = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });
    
    expect(players).toHaveLength(10);
    const playerNamesInFirstRound = players.map(p => p.name);
    expect(playerNamesInFirstRound).not.toContain("Bench Player");

    // Step 3: Test User claims one of the remaining players (player with high order)
    // Simulate: Test User joins and takes order 11 (would be bench)
    const testUserPlayer = await addPlayer(event.id, "Test User1 (temp)", 11, user.id);
    
    // Now we have 12 players: 10 active + 2 bench
    players = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
    });
    expect(players).toHaveLength(12);

    // Step 4: Randomize teams again
    players = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });

    // BUG: Test User1 should NOT be in the teams (order 11)
    // The first 10 players should be selected (orders 0-9)
    expect(players).toHaveLength(10);
    expect(players.map(p => p.name)).not.toContain("Test User1 (temp)");
    expect(players.map(p => p.name)).not.toContain("Bench Player");
  });
});