import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../lib/db.server";
import { resetApiRateLimitStore } from "../lib/apiRateLimit.server";
import { validateTeams, removePlayerFromTeams } from "../pages/api/events/[id]/players";

// Helper to create test user
async function seedUser(email: string, name: string) {
  return prisma.user.create({
    data: { id: `test-${email}`, email, name, role: "user" },
  });
}

// Helper to create test event
async function seedEvent(opts: { ownerId?: string; balanced?: boolean } = {}) {
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Test Location",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 10,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      balanced: opts.balanced ?? false,
      ownerId: opts.ownerId,
    },
  });
}

async function seedTeams(eventId: string, teamANames: string[], teamBNames: string[]) {
  const teamA = await prisma.teamResult.create({
    data: {
      name: "Ninjas",
      eventId,
      members: { create: teamANames.map((name, i) => ({ name, order: i })) },
    },
  });
  const teamB = await prisma.teamResult.create({
    data: {
      name: "Gunas",
      eventId,
      members: { create: teamBNames.map((name, i) => ({ name, order: i })) },
    },
  });
  return [teamA, teamB];
}

describe("Team Consistency: Preventing Bench Players in Active Teams", () => {
  beforeEach(async () => {
    await prisma.teamMember.deleteMany();
    await prisma.teamResult.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    await resetApiRateLimitStore();
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

describe("Team Roster Mutations: Minimal Movements", () => {
  beforeEach(async () => {
    await prisma.teamMember.deleteMany();
    await prisma.teamResult.deleteMany();
    await prisma.playerRating.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    await resetApiRateLimitStore();
  });

  it("removePlayerFromTeams replaces leaving player with promoted bench player in same team", async () => {
    const event = await seedEvent();

    // 11 players: 10 active + 1 bench
    for (let i = 0; i < 11; i++) {
      await prisma.player.create({
        data: { name: `P${i}`, eventId: event.id, order: i },
      });
    }

    // Teams: Ninjas=[P0,P1,P2,P3,P4], Gunas=[P5,P6,P7,P8,P9]
    await seedTeams(event.id, ["P0", "P1", "P2", "P3", "P4"], ["P5", "P6", "P7", "P8", "P9"]);

    // P3 leaves, P10 (bench) gets promoted into P3's team (Ninjas)
    await removePlayerFromTeams(event.id, "P3", "P10");

    const teams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: { orderBy: { order: "asc" } } },
    });

    const ninjas = teams.find(t => t.name === "Ninjas")!;
    const gunas = teams.find(t => t.name === "Gunas")!;

    // P10 should be in Ninjas (same team as P3 was)
    expect(ninjas.members.map(m => m.name)).toContain("P10");
    expect(ninjas.members.map(m => m.name)).not.toContain("P3");
    // Gunas should be unchanged
    expect(gunas.members.map(m => m.name)).toEqual(["P5", "P6", "P7", "P8", "P9"]);
    // Both teams should have 5 players
    expect(ninjas.members).toHaveLength(5);
    expect(gunas.members).toHaveLength(5);
  });

  it("removePlayerFromTeams with no bench keeps team short", async () => {
    const event = await seedEvent();

    for (let i = 0; i < 10; i++) {
      await prisma.player.create({
        data: { name: `P${i}`, eventId: event.id, order: i },
      });
    }

    await seedTeams(event.id, ["P0", "P1", "P2", "P3", "P4"], ["P5", "P6", "P7", "P8", "P9"]);

    // P3 leaves, no bench player
    await removePlayerFromTeams(event.id, "P3");

    const teams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: { orderBy: { order: "asc" } } },
    });

    const ninjas = teams.find(t => t.name === "Ninjas")!;
    const gunas = teams.find(t => t.name === "Gunas")!;

    // Ninjas should have 4 players (P3 removed, no replacement)
    expect(ninjas.members).toHaveLength(4);
    expect(ninjas.members.map(m => m.name)).not.toContain("P3");
    // Gunas unchanged
    expect(gunas.members).toHaveLength(5);
  });

  it("validateTeams removes bench players from teams without clearing valid members", async () => {
    const event = await seedEvent();

    // 12 players: 10 active + 2 bench
    for (let i = 0; i < 12; i++) {
      await prisma.player.create({
        data: { name: `P${i}`, eventId: event.id, order: i },
      });
    }

    // Teams with a bench player (P10) incorrectly in Ninjas
    await seedTeams(event.id, ["P0", "P1", "P2", "P3", "P10"], ["P5", "P6", "P7", "P8", "P9"]);

    const cleared = await validateTeams(event.id, event.maxPlayers);
    expect(cleared).toBe(true);

    const teams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: { orderBy: { order: "asc" } } },
    });

    const ninjas = teams.find(t => t.name === "Ninjas")!;
    const gunas = teams.find(t => t.name === "Gunas")!;

    // P10 should be removed, valid members kept
    expect(ninjas.members.map(m => m.name)).not.toContain("P10");
    expect(ninjas.members.map(m => m.name)).toEqual(expect.arrayContaining(["P0", "P1", "P2", "P3"]));
    // Gunas unchanged
    expect(gunas.members).toHaveLength(5);
  });

  it("validateTeams returns false when all team members are valid", async () => {
    const event = await seedEvent();

    for (let i = 0; i < 10; i++) {
      await prisma.player.create({
        data: { name: `P${i}`, eventId: event.id, order: i },
      });
    }

    await seedTeams(event.id, ["P0", "P1", "P2", "P3", "P4"], ["P5", "P6", "P7", "P8", "P9"]);

    const cleared = await validateTeams(event.id, event.maxPlayers);
    expect(cleared).toBe(false);

    // Teams should be untouched
    const teams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: true },
    });
    expect(teams[0].members).toHaveLength(5);
    expect(teams[1].members).toHaveLength(5);
  });

  it("removePlayerFromTeams with balanced event swaps promoted player to better team for ELO", async () => {
    const event = await seedEvent({ balanced: true });

    // Create 11 players with ratings
    for (let i = 0; i < 11; i++) {
      await prisma.player.create({
        data: { name: `P${i}`, eventId: event.id, order: i },
      });
    }

    // Ninjas: P0(1500), P1(1400), P2(1300), P3(1200), P4(1100) = total 6500
    // Gunas: P5(900), P6(800), P7(700), P8(600), P9(500) = total 3500
    // Gap = 3000
    const ratings = [1500, 1400, 1300, 1200, 1100, 900, 800, 700, 600, 500, 1000];
    for (let i = 0; i < 11; i++) {
      await prisma.playerRating.create({
        data: { eventId: event.id, name: `P${i}`, rating: ratings[i] },
      });
    }

    await seedTeams(event.id, ["P0", "P1", "P2", "P3", "P4"], ["P5", "P6", "P7", "P8", "P9"]);

    // P4 (1100) leaves Ninjas, P10 (1000) promoted
    // Without balancing: P10 goes to Ninjas → Ninjas=6400, Gunas=3500, gap=2900
    // With balancing: check if swapping P10 with a Gunas player reduces gap
    // Best swap: P10(1000) to Gunas, P5(900) to Ninjas → Ninjas=6300, Gunas=3600, gap=2700
    // That's better, so the swap should happen
    await removePlayerFromTeams(event.id, "P4", "P10");

    const teams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: { orderBy: { order: "asc" } } },
    });

    const ninjas = teams.find(t => t.name === "Ninjas")!;
    const gunas = teams.find(t => t.name === "Gunas")!;

    // Both teams should still have 5 players
    expect(ninjas.members).toHaveLength(5);
    expect(gunas.members).toHaveLength(5);

    // P10 should have been swapped to Gunas (weaker team) for better balance
    expect(gunas.members.map(m => m.name)).toContain("P10");
    expect(ninjas.members.map(m => m.name)).not.toContain("P10");
  });

  it("removePlayerFromTeams with balanced event does NOT swap when it wouldn't improve balance", async () => {
    const event = await seedEvent({ balanced: true });

    // Create 11 players
    for (let i = 0; i < 11; i++) {
      await prisma.player.create({
        data: { name: `P${i}`, eventId: event.id, order: i },
      });
    }

    // Balanced teams: Ninjas and Gunas have similar ELO
    // Ninjas: P0(1000), P1(1000), P2(1000), P3(1000), P4(1000) = 5000
    // Gunas: P5(1000), P6(1000), P7(1000), P8(1000), P9(1000) = 5000
    // P10 (bench) also 1000
    for (let i = 0; i < 11; i++) {
      await prisma.playerRating.create({
        data: { eventId: event.id, name: `P${i}`, rating: 1000 },
      });
    }

    await seedTeams(event.id, ["P0", "P1", "P2", "P3", "P4"], ["P5", "P6", "P7", "P8", "P9"]);

    // P4 leaves Ninjas, P10 promoted — all equal ratings, no swap needed
    await removePlayerFromTeams(event.id, "P4", "P10");

    const teams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: { orderBy: { order: "asc" } } },
    });

    const ninjas = teams.find(t => t.name === "Ninjas")!;

    // P10 should stay in Ninjas (same slot as P4) since swap wouldn't help
    expect(ninjas.members.map(m => m.name)).toContain("P10");
  });

  it("removePlayerFromTeams without balanced flag does not attempt ELO swap", async () => {
    const event = await seedEvent({ balanced: false });

    for (let i = 0; i < 11; i++) {
      await prisma.player.create({
        data: { name: `P${i}`, eventId: event.id, order: i },
      });
    }

    // Heavily skewed ratings — but balanced is off, so no swap
    const ratings = [1500, 1400, 1300, 1200, 1100, 900, 800, 700, 600, 500, 1000];
    for (let i = 0; i < 11; i++) {
      await prisma.playerRating.create({
        data: { eventId: event.id, name: `P${i}`, rating: ratings[i] },
      });
    }

    await seedTeams(event.id, ["P0", "P1", "P2", "P3", "P4"], ["P5", "P6", "P7", "P8", "P9"]);

    // P4 leaves, P10 promoted — balanced is off, P10 stays in Ninjas
    await removePlayerFromTeams(event.id, "P4", "P10");

    const teams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: { orderBy: { order: "asc" } } },
    });

    const ninjas = teams.find(t => t.name === "Ninjas")!;

    // P10 should stay in Ninjas (no ELO balancing when balanced=false)
    expect(ninjas.members.map(m => m.name)).toContain("P10");
  });
});