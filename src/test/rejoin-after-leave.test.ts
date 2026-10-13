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

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

import { fireWebhooks } from "~/lib/webhook.server";

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

/**
 * Count the player_joined push jobs enqueued for an event. The queue drain is
 * skipped under VITEST (applyRosterChange guards on process.env.VITEST), so the
 * NotificationJob rows are the observable push intent for every join branch.
 */
function countPlayerJoinedJobs(eventId: string): Promise<number> {
  return prisma.notificationJob.count({ where: { eventId, type: "player_joined" } });
}

beforeEach(async () => {
  await prisma.playerInvite.deleteMany();
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
    // Branch: archived GameParticipant re-join — must enqueue the push too.
    expect(await countPlayerJoinedJobs(event.id)).toBe(1);
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

  it("enqueues a player_joined push notification when a returning player rejoins", async () => {
    // Prod repro (event cmmkfrx8b0000o2ixrix1yp2m, 2026-10-11 10:32): the owner
    // left (player_left + spot_available jobs, webhook fired) and rejoined two
    // seconds later — the player_joined webhook fired, but NO player_joined
    // NotificationJob was ever created, so no push reached Android or iOS.
    // Fresh joins enqueue one via enqueueJoinNotifications; the re-join branches
    // used to return after a webhook-only notifyPlayerJoined, skipping the push.
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

    await archiveAndLeave({
      eventId: event.id,
      playerId: player.id,
      actor: { kind: "self", userId: user.id },
    });

    const res = await POST(
      ctx(event.id, { name: "Rodrigo Stange", linkToAccount: true }, { user: { id: user.id, name: user.name } }),
    );

    expect(res.status).toBe(200);
    // Branch: archived Player re-add. The leave side enqueues
    // player_left/spot_available; the rejoin side must enqueue exactly one
    // player_joined job — same as a fresh join.
    expect(await countPlayerJoinedJobs(event.id)).toBe(1);
  });

  it("fires the player_joined webhook when a returning player joins the current game", async () => {
    // Prod repro (event cmmkfrx8b0000o2ixrix1yp2m): players who re-joined after
    // the recurring reset were added to the game list but no player_joined
    // webhook fired — the WhatsApp bridge received 0 messages for 4 players.
    const user = await seedUser("Prucha", "u-prucha");
    const event = await seedRecurringEvent();

    // Existing Player + EventPlayer from a previous occurrence, not yet in the
    // current game → the P2002 re-join branch (players.ts:654) handles the join.
    await prisma.player.create({
      data: { eventId: event.id, name: "Prucha", userId: user.id, order: 5 },
    });
    await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Prucha", userId: user.id },
    });

    const res = await POST(
      ctx(event.id, { name: "Prucha", linkToAccount: true }, { user: { id: user.id, name: user.name } }),
    );

    expect(res.status).toBe(200);
    expect(fireWebhooks).toHaveBeenCalledWith(
      event.id,
      "player_joined",
      // Session user is "Prucha" → actor is the signed-in user who performed the join
      expect.objectContaining({ playerName: "Prucha", actor: "Prucha" }),
    );
    // Branch: recurring-reset re-join (Player/EventPlayer exist, no
    // GameParticipant for the current game) — must enqueue the push too.
    expect(await countPlayerJoinedJobs(event.id)).toBe(1);
  });

  it("does NOT fire game_full when legacy Player rows exceed maxPlayers but the game roster has room", async () => {
    // Prod repro (event cmmkfrx8b0000o2ixrix1yp2m): the legacy Player table
    // accumulates rows across recurring occurrences (19 active here), while the
    // current game's GameParticipant roster has only 4/10. A join used to derive
    // spotsLeft from the legacy count → wrongly fired game_full on a 4/10 game.
    const event = await seedRecurringEvent();

    // 19 legacy Player rows — accumulated occurrences, NOT the current roster
    for (let i = 0; i < 19; i++) {
      await prisma.player.create({
        data: { eventId: event.id, name: `Legacy ${i}`, order: i },
      });
    }
    // 4 active GameParticipants in the current game
    for (let i = 1; i <= 4; i++) {
      const ep = await prisma.eventPlayer.create({
        data: { eventId: event.id, name: `Active ${i}` },
      });
      await prisma.gameParticipant.create({
        data: { gameId: event.currentGameId!, eventPlayerId: ep.id, order: i },
      });
    }

    const res = await POST(
      ctx(event.id, { name: "Fresh Guy" }, null),
    );

    expect(res.status).toBe(200);
    expect(fireWebhooks).toHaveBeenCalledWith(
      event.id,
      "player_joined",
      // No session → actor is "anonymous"
      expect.objectContaining({ playerName: "Fresh Guy", isActive: true, spotsLeft: 5, actor: "anonymous" }),
    );
    const gameFullCalls = vi.mocked(fireWebhooks).mock.calls.filter(([id, type]) => id === event.id && type === "game_full");
    expect(gameFullCalls).toHaveLength(0);
  });

  it("does NOT announce a join for a pending self-invite when the player is already active", async () => {
    // Branch: pending self-invite, participant already active in the game.
    // Accepting a lingering invite here is an account link, not a join — it
    // must not push "X joined" (nor fire the webhook) for a no-op.
    const user = await seedUser("Rodrigo Stange", "u-rodrigo");
    const event = await seedRecurringEvent();

    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id },
    });
    await prisma.player.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id, order: 0 },
    });
    await prisma.gameParticipant.create({
      data: { gameId: event.currentGameId!, eventPlayerId: ep.id, order: 0 },
    });
    await prisma.playerInvite.create({
      data: {
        gameId: event.currentGameId!,
        eventPlayerId: ep.id,
        invitedByUserId: user.id,
        status: "pending",
        token: "tok-active",
      },
    });

    const res = await POST(
      ctx(event.id, { name: "Rodrigo Stange", linkToAccount: true }, { user: { id: user.id, name: user.name } }),
    );

    expect(res.status).toBe(200);
    expect(await countPlayerJoinedJobs(event.id)).toBe(0);
    const joinedCalls = vi.mocked(fireWebhooks).mock.calls.filter(
      ([id, type]) => id === event.id && type === "player_joined",
    );
    expect(joinedCalls).toHaveLength(0);
  });

  it("announces a join for a pending self-invite that re-activates an archived GameParticipant", async () => {
    // Branch: pending self-invite whose GameParticipant was archived by a leave
    // — a genuine re-join, so it must enqueue the push like every other branch.
    const user = await seedUser("Rodrigo Stange", "u-rodrigo");
    const event = await seedRecurringEvent();

    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id },
    });
    await prisma.player.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id, order: 0 },
    });
    await prisma.gameParticipant.create({
      data: {
        gameId: event.currentGameId!,
        eventPlayerId: ep.id,
        order: 0,
        archivedAt: new Date(Date.now() - 3600_000),
      },
    });
    await prisma.playerInvite.create({
      data: {
        gameId: event.currentGameId!,
        eventPlayerId: ep.id,
        invitedByUserId: user.id,
        status: "pending",
        token: "tok-archived",
      },
    });

    const res = await POST(
      ctx(event.id, { name: "Rodrigo Stange", linkToAccount: true }, { user: { id: user.id, name: user.name } }),
    );

    expect(res.status).toBe(200);
    expect(await countPlayerJoinedJobs(event.id)).toBe(1);
  });

  it("enqueues a game_full push when a returning player takes the last spot", async () => {
    // Finding 1: the re-join paths fired the game_full webhook but never the
    // push. A returning player filling the final spot must enqueue game_full,
    // exactly like the fresh-join path.
    const user = await seedUser("Rodrigo Stange", "u-rodrigo");
    const event = await seedRecurringEvent();

    // 9 active participants — one short of the 10-player roster.
    for (let i = 0; i < 9; i++) {
      const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: `P${i}` } });
      await prisma.gameParticipant.create({
        data: { gameId: event.currentGameId!, eventPlayerId: ep.id, order: i },
      });
    }
    // Returning player: Player + EventPlayer exist, GP archived by a prior leave.
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id },
    });
    await prisma.player.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id, order: 9 },
    });
    await prisma.gameParticipant.create({
      data: {
        gameId: event.currentGameId!,
        eventPlayerId: ep.id,
        order: 9,
        archivedAt: new Date(Date.now() - 3600_000),
      },
    });

    const res = await POST(
      ctx(event.id, { name: "Rodrigo Stange", linkToAccount: true }, { user: { id: user.id, name: user.name } }),
    );

    expect(res.status).toBe(200);
    expect(await countPlayerJoinedJobs(event.id)).toBe(1);
    expect(await prisma.notificationJob.count({ where: { eventId: event.id, type: "game_full" } })).toBe(1);
  });
});
