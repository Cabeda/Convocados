/** #XXX Unified "leave" flow used by:
 *  - User self-leave (RSVP no) → POST /api/events/[id]/leave
 *  - Organizer X (remove a player) → DELETE /api/events/[id]/players (refactored)
 *  - Admin declines a guest (sets Rsvp to "no" on a guest pill) → POST /api/events/[id]/players/[playerId]/rsvp
 *
 *  All three paths converge here so the warn-the-rest push + audit + re-index logic
 *  stays in one place. Soft-archives the Player row (preserves Rsvp audit trail +
 *  supports undo); the existing hard-delete X flow is being replaced by this.
 */
import { prisma } from "./db.server";
import { enqueueNotification, drainNotificationQueue } from "./notificationQueue.server";
import { fireWebhooks } from "./webhook.server";
import { syncPaymentsForEvent } from "./payments.server";
import { logEvent } from "./eventLog.server";
import { createLogger } from "./logger.server";
import { removePlayerFromTeams, validateTeams } from "../pages/api/events/[id]/players";
import { RSVP_WINDOW_HOURS } from "./rsvp.server";

const log = createLogger("leave");

export type LeaveActor =
  | { kind: "self"; userId: string }
  | { kind: "organizer"; userId: string };

export interface ArchiveAndLeaveInput {
  eventId: string;
  playerId: string;
  actor: LeaveActor;
  /** Origin used to build event URLs in the push body. Defaults to the production host. */
  origin?: string;
}

export interface ArchiveAndLeaveResult {
  ok: true;
  /** True iff the removed player was in the active list AND after removal no bench players remain.
   *  False for bench-player removals (the bench wasn't touched). */
  benchEmptyAfter: boolean;
  /** Whether the warn-the-rest push was fired (gated on benchEmptyAfter + within 48h). */
  warned: boolean;
  /** Data for the client's undo snackbar (60s window — see undo-remove). */
  undo: {
    name: string;
    order: number;
    userId: string | null;
    removedAt: number;
  };
}

/** True when current time is within RSVP_WINDOW_HOURS before kickoff. Used to gate the warn-the-rest push. */
export function isWithin48hBeforeKickoff(dateTime: Date, now: Date = new Date()): boolean {
  const hoursUntil = (dateTime.getTime() - now.getTime()) / (60 * 60 * 1000);
  return hoursUntil > 0 && hoursUntil <= RSVP_WINDOW_HOURS;
}

export async function archiveAndLeave(input: ArchiveAndLeaveInput): Promise<ArchiveAndLeaveResult> {
  const { eventId, playerId, actor } = input;
  const origin = input.origin ?? "https://convocados.cabeda.dev";

  // For organizer actors: the caller (the API route) is responsible for verifying the actor
  // is the owner or an admin. We trust the actor here.

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { where: { archivedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!event) throw new Error("Event not found.");

  const playerIndex = event.players.findIndex((p) => p.id === playerId);
  const player = event.players[playerIndex];
  if (!player) throw new Error("Player not found.");
  if (player.eventId !== eventId) throw new Error("Player is not in this event.");

  // Authorization is the caller's responsibility (see checkOwnership in the API route).
  // We still validate the self-leave invariant: a user can only leave on their own behalf.
  if (actor.kind === "self" && player.userId !== actor.userId) {
    throw new Error("You can only leave on your own behalf.");
  }

  const wasActive = playerIndex < event.maxPlayers;
  const firstBench = event.players[event.maxPlayers];

  // Soft-archive the Player row. Preserves the row + any Rsvp keyed on this playerId.
  await prisma.player.update({
    where: { id: playerId, eventId },
    data: { archivedAt: new Date() },
  });

  // Write Rsvp for the self-leave case. The organizer paths (X button, admin-decline-guest)
  // do not write Rsvp here — the caller is responsible (the guest RSVP endpoint writes its own
  // audit row via upsertGuestRsvp; the X button doesn't need to touch Rsvp at all).
  if (actor.kind === "self" && player.userId) {
    await prisma.rsvp.upsert({
      where: { userId_eventId: { userId: player.userId, eventId } },
      create: { eventId, userId: player.userId, status: "no", respondedAt: new Date() },
      update: { status: "no", respondedAt: new Date() },
    });
  }

  // Auto-unfollow on self-removal
  if (actor.kind === "self" && player.userId) {
    await prisma.eventFollow.deleteMany({
      where: { eventId, userId: player.userId },
    });
  }

  // Re-index remaining player orders
  const remaining = event.players.filter((p) => p.id !== playerId);
  await prisma.$transaction(
    remaining.map((p, i) =>
      p.order !== i
        ? prisma.player.update({ where: { id: p.id }, data: { order: i } })
        : prisma.$queryRaw`SELECT 1`,
    ),
  );

  // Auto-sync teams: remove player, optionally promote bench player into their team
  if (wasActive) {
    await removePlayerFromTeams(eventId, player.name, firstBench?.name);
  }
  await validateTeams(eventId, event.maxPlayers);

  // spotsLeft after removal
  const activeAfter = wasActive
    ? firstBench ? event.maxPlayers : Math.min(event.players.length - 1, event.maxPlayers)
    : Math.min(event.players.length - 1, event.maxPlayers);
  const spotsLeft = Math.max(0, event.maxPlayers - activeAfter);

  // Bench-empty after the removal. A bench is currently empty iff the total players fit
  // within maxPlayers (i.e. there were no bench players to start with). If the bench already
  // has players, the leave flow promotes the first one to active, so the slot is filled.
  const benchEmptyAfter: boolean | undefined = wasActive
    ? event.players.length <= event.maxPlayers
    : undefined;

  // Warn-the-rest push: within 48h AND wasActive AND bench is empty after.
  const shouldWarn = wasActive
    && benchEmptyAfter
    && isWithin48hBeforeKickoff(event.dateTime);

  const url = `${origin}/events/${eventId}`;
  const spotsLeftStr = String(spotsLeft);
  if (shouldWarn) {
    await enqueueNotification(
      eventId,
      "player_left",
      {
        title: event.title,
        key: "notifyPlayerLeft",
        params: { name: player.name, n: spotsLeftStr },
        url,
        spotsLeft,
      },
      actor.userId,
    );
  } else if (wasActive && firstBench) {
    // Existing promotion notification (unchanged from prior behavior — always fires on promotion)
    await enqueueNotification(
      eventId,
      "player_left_promoted",
      {
        title: event.title,
        key: "notifyPlayerLeftPromoted",
        params: { left: player.name, promoted: firstBench.name, n: spotsLeftStr },
        url,
        spotsLeft,
      },
      actor.userId,
    );
  } else if (!wasActive) {
    // Existing bench-leave notification (unchanged)
    await enqueueNotification(
      eventId,
      "player_left_bench",
      {
        title: event.title,
        key: "notifyPlayerLeftBench",
        params: { name: player.name },
        url,
        spotsLeft,
      },
      actor.userId,
    );
  }

  // Spot-available push: was full before AND now has an opening AND no bench. Gate on 48h too.
  const wasFull = event.players.length >= event.maxPlayers;
  if (wasActive && wasFull && !firstBench && spotsLeft > 0 && isWithin48hBeforeKickoff(event.dateTime)) {
    await enqueueNotification(
      eventId,
      "spot_available",
      {
        title: event.title,
        key: "notifySpotAvailable",
        params: { name: player.name },
        url,
        spotsLeft,
      },
      actor.userId,
    );
  }

  // Drain notification queue before responding
  if (!process.env.VITEST) {
    await drainNotificationQueue().catch((err) => {
      log.error({ eventId, err }, "Failed to drain notification queue");
    });
  }

  // Fire webhooks
  fireWebhooks(eventId, "player_left", { playerName: player.name, spotsLeft }).catch(() => {});

  // Recalculate payment shares if a cost is set
  await syncPaymentsForEvent(eventId);

  // Activity log
  const actorName = actor.kind === "self" ? player.name : null;
  const actorId = actor.userId;
  logEvent(eventId, "player_removed", actorName, actorId, { playerName: player.name, source: actor.kind }).catch(() => {});

  return {
    ok: true,
    benchEmptyAfter: benchEmptyAfter ?? false,
    warned: !!shouldWarn,
    undo: {
      name: player.name,
      order: playerIndex,
      userId: player.userId ?? null,
      removedAt: Date.now(),
    },
  };
}
