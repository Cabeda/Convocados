import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/players";
import { getSession } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { archiveAndLeave } from "~/lib/leave.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);

function ctx(eventId: string, body: any, session: { user: { id: string; name: string } } | null) {
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
async function seedRecurringEvent() {
  const event = await prisma.event.create({
    data: {
      title: "Ninjas da Areosa",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 10,
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

async function seedUser(name: string, id: string) {
  return prisma.user.create({
    data: { id, name, email: `${id}@t.com`, emailVerified: true },
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

describe("POST /api/events/[id]/players — rejoin after leave (game-scoped, ADR 0016)", () => {
  // Prod repro (event cmmkfrx8b0000o2ixrix1yp2m): user "Rodrigo Llancabure Stange"
  // left the game (GameParticipant archived), later re-added himself (Player row
  // un-archived), but the GameParticipant stayed archived. Every subsequent join
  // attempt hits P2002 → finds the archived GameParticipant → 409 "already in the
  // list", while the event page shows him NOT on the list.
  it("un-archives an archived GameParticipant instead of returning 409", async () => {
    const user = await seedUser("Rodrigo Stange", "u-rodrigo");
    const event = await seedRecurringEvent();

    // Player row active (from a previous re-add attempt), linked to the user
    await prisma.player.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id, order: 3 },
    });
    // EventPlayer + ARCHIVED GameParticipant — he left the current game earlier
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id },
    });
    await prisma.gameParticipant.create({
      data: {
        gameId: event.currentGameId!,
        eventPlayerId: ep.id,
        order: 3,
        archivedAt: new Date(Date.now() - 3600_000),
      },
    });

    const res = await POST(
      ctx(event.id, { name: "Rodrigo Stange", linkToAccount: true }, { user: { id: user.id, name: user.name } }),
    );

    expect(res.status).toBe(200);
    const gp = await prisma.gameParticipant.findUnique({
      where: { gameId_eventPlayerId: { gameId: event.currentGameId!, eventPlayerId: ep.id } },
    });
    expect(gp!.archivedAt).toBeNull();
  });

  it("full leave → rejoin cycle restores the GameParticipant", async () => {
    const user = await seedUser("Rodrigo Stange", "u-rodrigo");
    const event = await seedRecurringEvent();

    const player = await prisma.player.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id, order: 0 },
    });
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id },
    });
    await prisma.gameParticipant.create({
      data: { gameId: event.currentGameId!, eventPlayerId: ep.id, order: 0 },
    });

    // He leaves the game
    await archiveAndLeave({
      eventId: event.id,
      playerId: player.id,
      actor: { kind: "self", userId: user.id },
    });

    // He rejoins via QuickJoin
    const res = await POST(
      ctx(event.id, { name: "Rodrigo Stange", linkToAccount: true }, { user: { id: user.id, name: user.name } }),
    );

    expect(res.status).toBe(200);
    const gp = await prisma.gameParticipant.findUnique({
      where: { gameId_eventPlayerId: { gameId: event.currentGameId!, eventPlayerId: ep.id } },
    });
    expect(gp!.archivedAt).toBeNull();
    const rsvp = await prisma.rsvp.findFirst({
      where: { eventPlayerId: ep.id, gameId: event.currentGameId! },
    });
    expect(rsvp!.status).toBe("yes");
  });

  it("restores an archived GameParticipant when only the EventPlayer lingers (merge ghost)", async () => {
    const user = await seedUser("Rodrigo Stange", "u-rodrigo");
    const event = await seedRecurringEvent();

    // No Player row (deleted by a merge), but EventPlayer + archived GP linger
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Rodrigo Stange" },
    });
    await prisma.gameParticipant.create({
      data: {
        gameId: event.currentGameId!,
        eventPlayerId: ep.id,
        order: 2,
        archivedAt: new Date(Date.now() - 3600_000),
      },
    });

    const res = await POST(
      ctx(event.id, { name: "Rodrigo Stange", linkToAccount: true }, { user: { id: user.id, name: user.name } }),
    );

    expect(res.status).toBe(200);
    const gp = await prisma.gameParticipant.findUnique({
      where: { gameId_eventPlayerId: { gameId: event.currentGameId!, eventPlayerId: ep.id } },
    });
    expect(gp!.archivedAt).toBeNull();
  });

  it("still returns 409 when the GameParticipant is active (genuine duplicate)", async () => {
    const user = await seedUser("Rodrigo Stange", "u-rodrigo");
    const event = await seedRecurringEvent();

    await prisma.player.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id, order: 0 },
    });
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id },
    });
    await prisma.gameParticipant.create({
      data: { gameId: event.currentGameId!, eventPlayerId: ep.id, order: 0 },
    });

    const res = await POST(
      ctx(event.id, { name: "Rodrigo Stange", linkToAccount: true }, { user: { id: user.id, name: user.name } }),
    );

    expect(res.status).toBe(409);
  });
});
