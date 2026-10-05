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
import { getActiveRosterState } from "./roster.server";
import { enqueueNotification, drainNotificationQueue } from "./notificationQueue.server";
import { fireWebhooks } from "./webhook.server";
import { syncPaymentsForEvent } from "./payments.server";
import { syncGamePayments } from "./settlement.server";
import { logEvent } from "./eventLog.server";
import { createLogger } from "./logger.server";
import { removePlayerFromTeams, validateTeams } from "./teamFormation.server";
import { RSVP_WINDOW_HOURS } from "./rsvp.server";

const log = createLogger("leave");

export type LeaveActor =
  | { kind: "self"; userId: string | null }
  | { kind: "organizer"; userId: string | null };

export interface ArchiveAndLeaveInput {
  eventId: string;
  /**
   * Legacy `Player` row id. Optional: an EventPlayer-native identity (ADR 0026
   * guest invite links, or a re-join under a renamed display name) has no live
   * `Player` row at all, so `name` alone identifies it.
   */
  playerId?: string | null;
  /**
   * Roster name — the authoritative identity key (ADR 0016). Required whenever
   * `playerId` is absent; defaults to the `Player` row's name when both are given.
   */
  name?: string;
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

/** Name of whoever performed the leave/removal, for the webhook payload.
 *  Self-leave → the player's own name. Organizer removal → the organizer's
 *  user name when identifiable, otherwise "anonymous". */
export async function resolveActorName(playerName: string, actor: LeaveActor): Promise<string> {
  if (actor.kind === "self") return playerName;
  if (actor.userId) {
    const user = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true },
    });
    if (user?.name) return user.name;
  }
  return "anonymous";
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

  // ADR 0016: fetch currentGameId separately to ensure it's available
  const { currentGameId } = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { currentGameId: true },
  });

  const player = playerId
    ? event.players.find((p) => p.id === playerId) ?? null
    : null;

  // ADR 0016/0026: the roster the user actually sees is GameParticipant +
  // EventPlayer, so an EventPlayer-native identity can be live on the current
  // game with no live `Player` row. Fall back to the caller-supplied name so
  // self-leave works for those identities too.
  const rosterName = player?.name ?? input.name ?? null;
  if (!rosterName) throw new Error("Player not found.");
  if (player && player.eventId !== eventId) throw new Error("Player is not in this event.");

  // The EventPlayer is the identity every downstream surface keys on (Rsvp,
  // teams, payments, notifications). It is absent on events with no current
  // game, so it stays optional — but when present it is the authoritative link.
  const ep = await prisma.eventPlayer.findUnique({
    where: { eventId_name: { eventId, name: rosterName } },
  });

  // Authorization is the caller's responsibility (see checkOwnership in the API route).
  // We still validate the self-leave invariant: a user can only leave on their own behalf.
  // EventPlayer.userId is authoritative; the legacy Player row can carry a stale link.
  const identityUserId = ep?.userId ?? player?.userId ?? null;
  if (actor.kind === "self" && identityUserId !== actor.userId) {
    throw new Error("You can only leave on your own behalf.");
  }

  // ADR 0016: the current game's GameParticipant rows are the authoritative
  // roster. Legacy Player rows accumulate across recurring occurrences and would
  // inflate the active/bench/spotsLeft logic below, so we derive that state from
  // the shared getActiveRosterState helper (same source as the join path — this
  // duplication is how #722 slipped through before).
  const roster = await getActiveRosterState(eventId, event.maxPlayers, currentGameId);
  const activeCountBefore = roster.activeCount;
  const hasBench = roster.hasBench;
  const firstBenchName = roster.firstBenchName ?? undefined;
  const wasActive = roster.activeNames.has(rosterName);

  // Soft-archive the Player row when there is one. Preserves the row + any Rsvp
  // keyed on this playerId. EventPlayer-native identities have no Player row.
  if (player) {
    await prisma.player.update({
      where: { id: player.id, eventId },
      data: { archivedAt: new Date() },
    });
  }

  // ADR 0016: also archive the GameParticipant for the current Game
  if (currentGameId && ep) {
    await prisma.gameParticipant.updateMany({
      where: { gameId: currentGameId, eventPlayerId: ep.id },
      data: { archivedAt: new Date() },
    });
    // Payment overhaul: drop the leaver's payment row from the active list.
    await syncGamePayments(currentGameId, eventId);
  }

  // Write Rsvp. Every removal from the current game records status="no":
  //   - Self-leave (linked user): status="no" + respondedAt
  //   - Organizer removal (guest or linked user): status="no" + respondedByUserId audit.
  // The leaver lands in the Declined roster; a re-add/undo resets it to "yes".
  // ADR 0016: RSVP is keyed on (eventPlayerId, gameId).
  if (currentGameId && ep && ((actor.kind === "self" && identityUserId) || (actor.kind === "organizer" && actor.userId))) {
    await prisma.rsvp.upsert({
      where: { eventPlayerId_gameId: { eventPlayerId: ep.id, gameId: currentGameId } },
      create: {
        eventPlayerId: ep.id,
        gameId: currentGameId,
        status: "no",
        respondedAt: new Date(),
        ...(actor.kind === "organizer" ? { respondedByUserId: actor.userId ?? undefined } : {}),
      },
      update: {
        status: "no",
        respondedAt: new Date(),
        ...(actor.kind === "organizer" ? { respondedByUserId: actor.userId ?? undefined } : {}),
      },
    });
  }

  // Auto-unfollow on self-removal
  if (actor.kind === "self" && identityUserId) {
    await prisma.eventFollow.deleteMany({
      where: { eventId, userId: identityUserId },
    });
  }

  // Re-index remaining player orders
  const remaining = event.players.filter((p) => p.id !== player?.id);
  await prisma.$transaction(
    remaining.map((p, i) =>
      p.order !== i
        ? prisma.player.update({ where: { id: p.id }, data: { order: i } })
        : prisma.$queryRaw`SELECT 1`,
    ),
  );

  // Auto-sync teams: remove player, optionally promote bench player into their team
  if (wasActive) {
    await removePlayerFromTeams(eventId, rosterName, firstBenchName, currentGameId);
  }
  await validateTeams(eventId, event.maxPlayers, currentGameId);

  // spotsLeft after removal
  const activeAfter = wasActive ? (hasBench ? event.maxPlayers : activeCountBefore - 1) : activeCountBefore;
  const spotsLeft = Math.max(0, event.maxPlayers - activeAfter);

  // Bench-empty after the removal. A bench is currently empty iff the total players fit
  // within maxPlayers (i.e. there were no bench players to start with). If the bench already
  // has players, the leave flow promotes the first one to active, so the slot is filled.
  const benchEmptyAfter: boolean | undefined = wasActive
    ? !hasBench
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
        params: { name: rosterName, n: spotsLeftStr },
        url,
        spotsLeft,
      },
      actor.userId ?? undefined,
    );
  } else if (wasActive && firstBenchName) {
    // Existing promotion notification (unchanged from prior behavior — always fires on promotion)
    await enqueueNotification(
      eventId,
      "player_left_promoted",
      {
        title: event.title,
        key: "notifyPlayerLeftPromoted",
        params: { left: rosterName, promoted: firstBenchName, n: spotsLeftStr },
        url,
        spotsLeft,
      },
      actor.userId ?? undefined,
    );
  } else if (!wasActive) {
    // Existing bench-leave notification (unchanged)
    await enqueueNotification(
      eventId,
      "player_left_bench",
      {
        title: event.title,
        key: "notifyPlayerLeftBench",
        params: { name: rosterName },
        url,
        spotsLeft,
      },
      actor.userId ?? undefined,
    );
  }

  // ADR 0017: Spot-available push — fire whenever a spot opens and game is in the future (Tier 2).
  // Previously gated on 48h; now always fires so interested players/followers learn immediately.
  const wasFull = activeCountBefore >= event.maxPlayers;
  if (wasActive && wasFull && !hasBench && spotsLeft > 0 && event.dateTime > new Date()) {
    await enqueueNotification(
      eventId,
      "spot_available",
      {
        title: event.title,
        key: "notifySpotAvailable",
        params: { name: rosterName },
        url: `${url}?action=join`,
        spotsLeft,
      },
      actor.userId ?? undefined,
    );
    // ADR 0017: Reset few_spots_left dedup so it can fire again next fill cycle
    await prisma.event.update({ where: { id: eventId }, data: { fewSpotsLeftNotified: false } }).catch(() => {});
  }

  // Drain notification queue before responding
  if (!process.env.VITEST) {
    await drainNotificationQueue().catch((err) => {
      log.error({ eventId, err }, "Failed to drain notification queue");
    });
  }

  // Fire webhooks
  const webhookActor = await resolveActorName(rosterName, actor);
  fireWebhooks(eventId, "player_left", { playerName: rosterName, spotsLeft, actor: webhookActor }).catch(() => {});

  // Recalculate payment shares if a cost is set
  await syncPaymentsForEvent(eventId);

  // Activity log
  const actorName = actor.kind === "self" ? rosterName : null;
  const actorId = actor.userId;
  logEvent(eventId, "player_removed", actorName, actorId, { playerName: rosterName, source: actor.kind }).catch(() => {});

  return {
    ok: true,
    benchEmptyAfter: benchEmptyAfter ?? false,
    warned: !!shouldWarn,
    undo: {
      name: rosterName,
      order: player ? event.players.findIndex((p) => p.id === player.id) : roster.members.findIndex((m) => m.name === rosterName),
      userId: identityUserId,
      removedAt: Date.now(),
    },
  };
}
