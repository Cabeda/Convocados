/**
 * Ordering regression tests — prod repro: event cmmkfrx8b0000o2ixrix1yp2m
 * ("Ninjas da Areosa") showed the current game's player list at orders
 * 0,1,2,3,14 — a 9-slot gap. Issue #657 (Player order issues).
 *
 * Root cause: GameParticipant.order is computed from DIFFERENT sources
 * depending on the join path:
 *   - Fresh join:      order = event.players.length  (event-scoped, grows across games)
 *   - Rejoin after reset: order = gameParticipant.count()  (game-scoped, collides with gaps)
 * These diverge once the Player table accumulates players across games.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST as addPlayer } from "~/pages/api/events/[id]/players";
import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { getSession } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);

function ctx(eventId: string, body: any, session: { user: { id: string; name: string } } | null = null) {
  mockGetSession.mockResolvedValue(session as any);
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/players`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": "test-client" },
      body: JSON.stringify(body),
    }),
  } as any;
}

/** Recurring event with a current (upcoming) Game — ADR 0016 game-scoped player list. */
async function seedRecurringEvent(maxPlayers = 10) {
  const event = await prisma.event.create({
    data: {
      title: "Ninjas da Areosa",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers,
      isRecurring: true,
      recurrenceRule: "FREQ=WEEKLY",
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

async function seedGameParticipant(eventId: string, gameId: string, name: string, order: number, opts: { archived?: boolean } = {}) {
  const ep = await prisma.eventPlayer.upsert({
    where: { eventId_name: { eventId, name } },
    create: { eventId, name },
    update: {},
  });
  return prisma.gameParticipant.create({
    data: {
      gameId,
      eventPlayerId: ep.id,
      order,
      ...(opts.archived ? { archivedAt: new Date(Date.now() - 3600_000) } : {}),
    },
  });
}

beforeEach(async () => {
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

describe("Player ordering — fresh join lands at end of the CURRENT game queue", () => {
  it("does not use the event-wide player count when assigning GameParticipant.order", async () => {
    const event = await seedRecurringEvent();

    // Simulate a long-lived recurring event: the event-level Player table
    // has accumulated 14 players across previous games (they persist).
    for (let i = 0; i < 14; i++) {
      await prisma.player.create({
        data: { eventId: event.id, name: `Legacy ${i}`, order: i },
      });
    }
    // The current game only has 4 active participants (orders 0..3)
    await seedGameParticipant(event.id, event.currentGameId!, "Manuel", 0);
    await seedGameParticipant(event.id, event.currentGameId!, "Tiago", 1);
    await seedGameParticipant(event.id, event.currentGameId!, "João", 2);
    await seedGameParticipant(event.id, event.currentGameId!, "TF", 3);

    // A brand-new player joins the current game
    const res = await addPlayer(ctx(event.id, { name: "Ruben Almeida" }));
    expect(res.status).toBe(200);

    const eventRes = await getEvent({ params: { id: event.id }, request: new Request("http://localhost/") } as any);
    const body = await eventRes.json();
    const orders = body.players.map((p: any) => p.order);

    // The queue must be contiguous — the new player goes to position 4,
    // NOT to order 14 (the event-wide Player count).
    expect(orders).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("Player ordering — rejoin from an earlier game must not jump ahead", () => {
  it("rejoining player lands AFTER players who joined the current game first", async () => {
    const event = await seedRecurringEvent();

    // Fresh player joins the current game first
    await addPlayer(ctx(event.id, { name: "Newbie" }));

    // Player from a previous game rejoins (Player row exists at event level,
    // but has no GameParticipant in the current game)
    await prisma.player.create({
      data: { eventId: event.id, name: "OldTimer", order: 0 },
    });
    const res = await addPlayer(ctx(event.id, { name: "OldTimer" }));
    expect(res.status).toBe(200);

    const eventRes = await getEvent({ params: { id: event.id }, request: new Request("http://localhost/") } as any);
    const body = await eventRes.json();
    const names = body.players.map((p: any) => p.name);

    // Newbie joined first → must stay ahead of the rejoining OldTimer
    expect(names.indexOf("Newbie")).toBeLessThan(names.indexOf("OldTimer"));
  });
});

describe("Player ordering — legacy event (no currentGameId) appends via Player table", () => {
  it("adds player at end even when order values have gaps", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Order Gap Test",
        location: "Pitch A",
        dateTime: new Date(Date.now() + 86400_000),
      },
    });

    const playerNames = ["Alice", "Bob", "Charlie", "Diana"];
    const orders = [0, 1, 5, 9];
    for (let i = 0; i < playerNames.length; i++) {
      await prisma.player.create({
        data: { name: playerNames[i], eventId: event.id, order: orders[i] },
      });
    }

    const res = await addPlayer(ctx(event.id, { name: "Manecas" }));
    expect(res.status).toBe(200);

    const eventRes = await getEvent({ params: { id: event.id }, request: new Request("http://localhost/") } as any);
    const data = await eventRes.json();
    const names = data.players.map((p: any) => p.name);
    expect(names[names.length - 1]).toBe("Manecas");

    const manecas = await prisma.player.findFirst({
      where: { eventId: event.id, name: "Manecas" },
    });
    expect(manecas!.order).toBe(10);
  });
});

describe("Player ordering — count-based append must not collide with archived gaps", () => {
  it("a rejoin after leave lands at max(order)+1, not at a colliding count()", async () => {
    const event = await seedRecurringEvent();

    // Player A leaves, leaving an archived GameParticipant at order 0.
    // Live participants: B(order 1), C(order 2). count(live) = 2 → a
    // count()-based append would assign the new player order 2, colliding
    // with C.
    await seedGameParticipant(event.id, event.currentGameId!, "A", 0, { archived: true });
    await seedGameParticipant(event.id, event.currentGameId!, "B", 1);
    await seedGameParticipant(event.id, event.currentGameId!, "C", 2);

    await prisma.player.create({ data: { eventId: event.id, name: "B", order: 1 } });
    await prisma.player.create({ data: { eventId: event.id, name: "C", order: 2 } });

    const res = await addPlayer(ctx(event.id, { name: "D" }));
    expect(res.status).toBe(200);

    const eventRes = await getEvent({ params: { id: event.id }, request: new Request("http://localhost/") } as any);
    const body = await eventRes.json();
    const orders = body.players.map((p: any) => p.order);

    // No collisions — every order unique
    expect(new Set(orders).size).toBe(orders.length);
  });
});
