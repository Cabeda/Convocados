import { describe, it, expect, beforeEach, vi } from "vitest";
import type * as AuthHelpersServer from "~/lib/auth.helpers.server";
import { prisma } from "~/lib/db.server";
import { PUT } from "~/pages/api/events/[id]/reorder-players";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof AuthHelpersServer>("~/lib/auth.helpers.server");
  return {
    ...actual,
    checkOwnership: vi.fn(),
  };
});

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
  vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
});

function ctx(eventId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/reorder-players`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: eventId },
  } as any;
}

async function seedEventWithGame(ownerId: string) {
  const event = await prisma.event.create({
    data: {
      title: "Reorder Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 10,
      ownerId,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

describe("PUT /api/events/[id]/reorder-players", () => {
  // ADR 0016 regression: the event GET returns EventPlayer ids, so the UI drag-reorder
  // sends those. The endpoint must resolve them AND sync GameParticipant.order (which
  // is what the UI actually renders).
  it("accepts EventPlayer ids and syncs GameParticipant order", async () => {
    const owner = await prisma.user.create({
      data: { id: "owner-ro-1", name: "Owner", email: "owner-ro-1@t.com", emailVerified: true },
    });
    const event = await seedEventWithGame(owner.id);

    const alice = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
    const bob = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });
    const epAlice = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice" } });
    const epBob = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Bob" } });
    await prisma.gameParticipant.create({ data: { gameId: event.currentGameId, eventPlayerId: epAlice.id, order: 0 } });
    await prisma.gameParticipant.create({ data: { gameId: event.currentGameId, eventPlayerId: epBob.id, order: 1 } });

    // Drag Bob above Alice — sending EventPlayer ids (what the UI has)
    const res = await PUT(ctx(event.id, { playerIds: [epBob.id, epAlice.id] }));
    expect(res.status).toBe(200);

    // Player.order updated
    const players = await prisma.player.findMany({ where: { eventId: event.id }, orderBy: { order: "asc" } });
    expect(players.map((p) => p.name)).toEqual(["Bob", "Alice"]);
    expect(players[0].id).toBe(bob.id);
    expect(players[1].id).toBe(alice.id);

    // GameParticipant.order synced — this is what the event GET renders
    const gps = await prisma.gameParticipant.findMany({
      where: { gameId: event.currentGameId },
      orderBy: { order: "asc" },
      include: { eventPlayer: true },
    });
    expect(gps.map((g) => g.eventPlayer.name)).toEqual(["Bob", "Alice"]);
  });

  it("still accepts Player ids and syncs GameParticipant order", async () => {
    const owner = await prisma.user.create({
      data: { id: "owner-ro-2", name: "Owner", email: "owner-ro-2@t.com", emailVerified: true },
    });
    const event = await seedEventWithGame(owner.id);

    const alice = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
    const bob = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });
    const epAlice = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice" } });
    const epBob = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Bob" } });
    await prisma.gameParticipant.create({ data: { gameId: event.currentGameId, eventPlayerId: epAlice.id, order: 0 } });
    await prisma.gameParticipant.create({ data: { gameId: event.currentGameId, eventPlayerId: epBob.id, order: 1 } });

    const res = await PUT(ctx(event.id, { playerIds: [bob.id, alice.id] }));
    expect(res.status).toBe(200);

    const gps = await prisma.gameParticipant.findMany({
      where: { gameId: event.currentGameId },
      orderBy: { order: "asc" },
      include: { eventPlayer: true },
    });
    expect(gps.map((g) => g.eventPlayer.name)).toEqual(["Bob", "Alice"]);
  });

  it("returns 400 when ids match neither Player nor EventPlayer sets", async () => {
    const owner = await prisma.user.create({
      data: { id: "owner-ro-3", name: "Owner", email: "owner-ro-3@t.com", emailVerified: true },
    });
    const event = await seedEventWithGame(owner.id);
    await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });

    const res = await PUT(ctx(event.id, { playerIds: ["fake-id"] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on duplicate ids even when the set matches", async () => {
    const owner = await prisma.user.create({
      data: { id: "owner-ro-4", name: "Owner", email: "owner-ro-4@t.com", emailVerified: true },
    });
    const event = await seedEventWithGame(owner.id);
    const alice = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
    const bob = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });

    // 3 ids for 2 players, with a duplicate — must be rejected
    const res = await PUT(ctx(event.id, { playerIds: [alice.id, bob.id, alice.id] }));
    expect(res.status).toBe(400);
  });

  it("accepts a mixed array of Player and EventPlayer ids (per-id resolution)", async () => {
    const owner = await prisma.user.create({
      data: { id: "owner-ro-5", name: "Owner", email: "owner-ro-5@t.com", emailVerified: true },
    });
    const event = await seedEventWithGame(owner.id);
    await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
    const bob = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });
    const epAlice = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice" } });

    const res = await PUT(ctx(event.id, { playerIds: [bob.id, epAlice.id] }));
    expect(res.status).toBe(200);

    const players = await prisma.player.findMany({ where: { eventId: event.id }, orderBy: { order: "asc" } });
    expect(players.map((p) => p.name)).toEqual(["Bob", "Alice"]);
  });

  it("appends GameParticipants without a matching Player after the reordered ones", async () => {
    const owner = await prisma.user.create({
      data: { id: "owner-ro-6", name: "Owner", email: "owner-ro-6@t.com", emailVerified: true },
    });
    const event = await seedEventWithGame(owner.id);
    const alice = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
    const bob = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });
    const epAlice = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice" } });
    const epBob = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Bob" } });
    // Ghost participant: in the game but no Player row (name drift / archived player)
    const epGhost = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Ghost" } });
    await prisma.gameParticipant.create({ data: { gameId: event.currentGameId, eventPlayerId: epAlice.id, order: 0 } });
    await prisma.gameParticipant.create({ data: { gameId: event.currentGameId, eventPlayerId: epBob.id, order: 1 } });
    await prisma.gameParticipant.create({ data: { gameId: event.currentGameId, eventPlayerId: epGhost.id, order: 0 } });

    const res = await PUT(ctx(event.id, { playerIds: [bob.id, alice.id] }));
    expect(res.status).toBe(200);

    const gps = await prisma.gameParticipant.findMany({
      where: { gameId: event.currentGameId },
      orderBy: { order: "asc" },
      include: { eventPlayer: true },
    });
    // No order collisions; ghost keeps a trailing slot
    expect(gps.map((g) => g.eventPlayer.name)).toEqual(["Bob", "Alice", "Ghost"]);
    expect(gps.map((g) => g.order)).toEqual([0, 1, 2]);
  });
});
