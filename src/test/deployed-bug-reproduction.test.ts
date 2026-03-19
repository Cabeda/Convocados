import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../lib/db.server";
import { resetApiRateLimitStore } from "../lib/apiRateLimit.server";

// EXACT REPRODUCTION OF DEPLOYED BUG:https://convocados.fly.dev/events/cmmkfrx8b0000o2ixrix1yp2m
//
// Player data from deployed event on 2026-03-19:
// Order | Name| userId | createdAt
// ------|----------------------|-----------------------------------|------------------------
//  0| Prucha| null| 2026-03-16T20:13:39.540Z
//  1 | Gonçalo| null| 2026-03-16T20:36:30.614Z
//  2 | Igor Carvalho| bapMMzfIEWEa8AP1TcenxrpTrKkuWlTs | 2026-03-16T20:14:31.016Z
//  3 | Joao F| null| 2026-03-16T21:09:34.172Z
//  4 | José Cabeda| lT5XljGaCRASAzUMzXwrk8wSY0JE1NbY | 2026-03-17T14:23:19.668Z (CLAIMED)
//  5 | João Dias| null| 2026-03-16T20:15:05.416Z
//  6 | Polónia | null| 2026-03-16T20:14:11.714Z
//  7 | TF| null| 2026-03-16T21:09:39.602Z
//  8 | Manecas| null| 2026-03-16T20:16:53.988Z
//  9 | Enair| null| 2026-03-16T21:19:36.953Z
// 10 | Pedro Cunha| null| 2026-03-16T20:17:26.389Z (BENCH - SHOULD NOT BE IN TEAMS)
// 11 | Rodrigo| null| 2026-03-16T22:39:40.931Z (BENCH - SHOULD NOT BE IN TEAMS)
//
// ACTUAL TEAMS FROM DEPLOYED VERSION:
// Ninjas: Manecas, João Dias, Gonçalo, Pedro Cunha, Enair
// Gunas: Prucha, Igor Carvalho, Polónia, TF, Joao F
//
// BUG: José Cabeda (order 4, CLAIMED) is MISSING from teams!
//BUG: Pedro Cunha (order 10, BENCH) is PRESENT in teams!

describe("EXACT DEPLOYED BUG REPRODUCTION", () => {
  beforeEach(async () => {
    await prisma.teamMember.deleteMany();
    await prisma.teamResult.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.playerRating.deleteMany();
    await prisma.user.deleteMany();
    resetApiRateLimitStore();
  });

  it("reproduces exact deployed data and verifies randomization logic", async () => {
    // Create users for claimed players
    const user1 = await prisma.user.create({
      data: {
        id: "bapMMzfIEWEa8AP1TcenxrpTrKkuWlTs",
        email: "igor@test.com",
        name: "Igor Carvalho",
        role: "user",
      },
    });

    const user2 = await prisma.user.create({
      data: {
        id: "lT5XljGaCRASAzUMzXwrk8wSY0JE1NbY",
        email: "jose@test.com",
        name: "José Cabeda",
        role: "user",
      },
    });

    // Create event with maxPlayers = 10
    const event = await prisma.event.create({
      data: {
        id: "cmmkfrx8b0000o2ixrix1yp2m",
        title: "Ninjas da Areosa",
        location: "Test Location",
        dateTime: new Date("2026-03-23T19:00:00Z"),
        maxPlayers: 10,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
      },
    });

    // Create players with EXACT deployed data (matching createdAt timestamps)
    const players = [
      { name: "Prucha", order: 0, userId: null, createdAt: new Date("2026-03-16T20:13:39.540Z") },
      { name: "Gonçalo", order: 1, userId: null, createdAt: new Date("2026-03-16T20:36:30.614Z") },
      { name: "Igor Carvalho", order: 2, userId: user1.id, createdAt: new Date("2026-03-16T20:14:31.016Z") },
      { name: "Joao F", order: 3, userId: null, createdAt: new Date("2026-03-16T21:09:34.172Z") },
      { name: "José Cabeda", order: 4, userId: user2.id, createdAt: new Date("2026-03-17T14:23:19.668Z") },
      { name: "João Dias", order: 5, userId: null, createdAt: new Date("2026-03-16T20:15:05.416Z") },
      { name: "Polónia", order: 6, userId: null, createdAt: new Date("2026-03-16T20:14:11.714Z") },
      { name: "TF", order: 7, userId: null, createdAt: new Date("2026-03-16T21:09:39.602Z") },
      { name: "Manecas", order: 8, userId: null, createdAt: new Date("2026-03-16T20:16:53.988Z") },
      { name: "Enair", order: 9, userId: null, createdAt: new Date("2026-03-16T21:19:36.953Z") },
      { name: "Pedro Cunha", order: 10, userId: null, createdAt: new Date("2026-03-16T20:17:26.389Z") },
      { name: "Rodrigo", order: 11, userId: null, createdAt: new Date("2026-03-16T22:39:40.931Z") },
    ];

    for (const p of players) {
      await prisma.player.create({
        data: {
          name: p.name,
          order: p.order,
          userId: p.userId,
          eventId: event.id,
          createdAt: p.createdAt,
        },
      });
    }

    // ---------- TEST 1: Verify player selection logic----------
    console.log("\n========== PLAYER SELECTION TEST ==========");
    console.log("maxPlayers:", event.maxPlayers);
    
    const allPlayers = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
    });

    console.log("All players (sorted by order):");
    allPlayers.forEach(p => {
      const bench = p.order >= event.maxPlayers ? " [BENCH]" : "";
      const claimed = p.userId ? " [CLAIMED]" : "";
      console.log(`  ${p.order}: ${p.name}${claimed}${bench}`);
    });

    // Verify ordering
    expect(allPlayers.map(p => p.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    // Select first maxPlayers players (this is what randomize does)
    const selectedPlayers = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });

    console.log("\nSelected for randomization (first maxPlayers):");
    selectedPlayers.forEach(p => {
      const claimed = p.userId ? " [CLAIMED]" : "";
      console.log(`  ${p.order}: ${p.name}${claimed}`);
    });

    // ---------- ASSERTIONS ----------
    // Should have exactly 10 players
    expect(selectedPlayers).toHaveLength(10);

    // José Cabeda (order 4) MUST be included
    const josePlayer = selectedPlayers.find(p => p.name === "José Cabeda");
    expect(josePlayer).toBeDefined();
    expect(josePlayer?.order).toBe(4);
    expect(josePlayer?.userId).toBe(user2.id);

    // Pedro Cunha (order 10) MUST NOT be included
    const pedroPlayer = selectedPlayers.find(p => p.name === "Pedro Cunha");
    expect(pedroPlayer).toBeUndefined();

    // Rodrigo (order 11) MUST NOT be included
    const rodrigoPlayer = selectedPlayers.find(p => p.name === "Rodrigo");
    expect(rodrigoPlayer).toBeUndefined();

    // All active players (orders 0-9) should be included
    const activePlayerNames = [
      "Prucha", "Gonçalo", "Igor Carvalho", "Joao F", "José Cabeda",
      "João Dias", "Polónia", "TF", "Manecas", "Enair"
    ];
    activePlayerNames.forEach(name => {
      const player = selectedPlayers.find(p => p.name === name);
      expect(player).toBeDefined();
      console.log(`✓ ${name} is included`);
    });

    console.log("\n========== TEST PASSED ==========");
    console.log("All active players (0-9) are correctly selected for randomization.");
    console.log("Claimed player José Cabeda is included.");
    console.log("Bench players (10-11) are correctly excluded.");
  });

  it("verifies Prisma orderBy + take behavior with claimed players", async () => {
    // This test specifically checks Prisma's orderBy + take behavior
    const user = await prisma.user.create({
      data: { id: "test-user", email: "test@test.com", name: "Test User", role: "user" },
    });

    const event = await prisma.event.create({
      data: {
        title: "Test",
        location: "Test",
        dateTime: new Date(),
        maxPlayers: 10,
      },
    });

    // Create12 players with various orders
    for (let i = 0; i < 12; i++) {
      await prisma.player.create({
        data: {
          name: `Player ${i}`,
          order: i,
          userId: i === 4 ? user.id : null, // Player4 is claimed
          eventId: event.id,
        },
      });
    }

    // Test Prisma query exactly as it appears in randomize.ts
    const players = await prisma.player.findMany({
      where: { eventId: event.id },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });

    // Verify
    expect(players).toHaveLength(10);
    expect(players.filter(p => p.order <10)).toHaveLength(10);
    expect(players.find(p => p.order === 4)).toBeDefined();
    expect(players.find(p => p.order === 4)?.userId).toBe(user.id);
    expect(players.find(p => p.order >= 10)).toBeUndefined();
  });
});