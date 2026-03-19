import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../lib/db.server";
import { resetApiRateLimitStore } from "../lib/apiRateLimit.server";

// Helper to create test user
async function seedUser(email: string, name: string) {
  return prisma.user.create({
    data: { id: `test-${email}`, email, name, role: "user" },
  });
}

// Helper to create test event
async function seedEvent(ownerId?: string) {
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Test Location",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 10,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId,
    },
  });
}

describe("Team Consistency: Preventing Bench Players in Active Teams", () => {
  beforeEach(async () => {
    await prisma.teamMember.deleteMany();
    await prisma.teamResult.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    resetApiRateLimitStore();
  });

  it("should only include active players (first maxPlayers) in randomization", async () => {
    const event = await seedEvent();

    // Create 12 players (10 active + 2 bench)
    for (let i = 0; i < 12; i++) {
      await prisma.player.create({
        data: { name: `Player ${i}`, eventId: event.id, order: i },
      });
    }

    // Simulate the randomize endpoint logic: get first maxPlayers players
    const players = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });

    // Should have exactly 10 players
    expect(players).toHaveLength(10);

    // Should only have players with order 0-9
    expect(players.every(p => p.order < 10)).toBe(true);

    // Should not have bench players (order >= 10)
    expect(players.find(p => p.order >= 10)).toBeUndefined();
    expect(players.find(p => p.name === "Player 10")).toBeUndefined();
    expect(players.find(p => p.name === "Player 11")).toBeUndefined();
  });

  it("should include claimed player in team generation", async () => {
    const user = await seedUser("test@test.com", "Claimed User");
    const event = await seedEvent();

    // Create 9 anonymous players (order 0-8)
    for (let i = 0; i < 9; i++) {
      await prisma.player.create({
        data: { name: `Player ${i}`, eventId: event.id, order: i },
      });
    }

    // Create 1 claimed player (order 9)
    await prisma.player.create({
      data: { name: "Claimed User", eventId: event.id, order: 9, userId: user.id },
    });

    // Create 2 bench players (order 10-11)
    for (let i = 0; i < 2; i++) {
      await prisma.player.create({
        data: { name: `Bench ${i}`, eventId: event.id, order: 10 + i },
      });
    }

    // Simulate randomize logic
    const players = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });

    // Should have exactly 10 players
    expect(players).toHaveLength(10);

    // Claimed player should be included
    const claimedPlayer = players.find(p => p.userId === user.id);
    expect(claimedPlayer).toBeDefined();
    expect(claimedPlayer?.name).toBe("Claimed User");
    expect(claimedPlayer?.order).toBe(9);

    // Bench players should be excluded
    expect(players.find(p => p.order >= 10)).toBeUndefined();
  });

  it("should detect bench players in existing teams", async () => {
    const event = await seedEvent();

    // Create 12 players
    const players = [];
    for (let i = 0; i < 12; i++) {
      const p = await prisma.player.create({
        data: { name: `Player ${i}`, eventId: event.id, order: i },
      });
      players.push(p);
    }

    // Create teams with a bench player included (simulating the bug)
    await prisma.teamResult.createMany({
      data: [
        { name: "Ninjas", eventId: event.id },
        { name: "Gunas", eventId: event.id },
      ],
    });

    const teams = await prisma.teamResult.findMany({ where: { eventId: event.id } });
    for (const team of teams) {
      const teamPlayers = team.name === "Ninjas"
        ? [players[0], players[1], players[2], players[3], players[10]] // Includes bench player (order 10)
        : [players[4], players[5], players[6], players[7], players[8]];

      await prisma.teamMember.createMany({
        data: teamPlayers.map((p, i) => ({
          name: p.name,
          order: i,
          teamResultId: team.id,
        })),
      });
    }

    // Check for bench players in teams (simulating reset-player-order validation)
    const activePlayerNames = new Set(players.slice(0, 10).map(p => p.name));
    const existingTeams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: true },
    });

    const hasBenchPlayersInTeams = existingTeams.some(team =>
      team.members.some(member => !activePlayerNames.has(member.name))
    );

    expect(hasBenchPlayersInTeams).toBe(true);
  });

  it("should validate team membership contains only active players", async () => {
    const event = await seedEvent();

    // Create 10 active players
    for (let i = 0; i < 10; i++) {
      await prisma.player.create({
        data: { name: `Active${i}`, eventId: event.id, order: i },
      });
    }

    // Create valid teams with only active players
    await prisma.teamResult.createMany({
      data: [
        { name: "Ninjas", eventId: event.id },
        { name: "Gunas", eventId: event.id },
      ],
    });

    const teams = await prisma.teamResult.findMany({ where: { eventId: event.id } });
    for (const team of teams) {
      const teamPlayers = team.name === "Ninjas"
        ? ["Active0", "Active1", "Active2", "Active3", "Active4"]
        : ["Active5", "Active6", "Active7", "Active8", "Active9"];

      await prisma.teamMember.createMany({
        data: teamPlayers.map((name, i) => ({
          name,
          order: i,
          teamResultId: team.id,
        })),
      });
    }

    // Validate: all team members should be active players
    const allPlayers = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
    });
    const activePlayerNames = new Set(allPlayers.slice(0, 10).map(p => p.name));
    const existingTeams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: true },
    });

    for (const team of existingTeams) {
      for (const member of team.members) {
        expect(activePlayerNames.has(member.name)).toBe(true);
      }
    }
  });
});