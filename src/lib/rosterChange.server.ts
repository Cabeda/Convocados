/**
 * Roster change helpers — the repeated steps of re-adding a player to the
 * current Game. Extracted from the players route so the "queue semantics"
 * (a re-join goes to the end of the list) and the "re-join resets Attendance"
 * rule live in one place instead of three near-identical copies.
 */
import { prisma } from "./db.server";
import { nextGameParticipantOrder } from "./game.server";
import { activeParticipantsWhere } from "./activeParticipants.server";
import { upsertGameParticipantForRoster } from "./rosterCore.server";

/** Next free slot at the end of the active list (queue semantics). */
async function nextPlayerOrder(eventId: string): Promise<number> {
  const maxOrder = await prisma.player.aggregate({
    where: { eventId, archivedAt: null },
    _max: { order: true },
  });
  return (maxOrder._max.order ?? -1) + 1;
}

/**
 * Move an existing Player row to the end of the active list (queue semantics).
 * When `reactivate` is set the row is un-archived; when `linkUserId` is given
 * and the row has no account yet, the account is linked.
 */
export async function movePlayerToEndOfList(
  eventId: string,
  playerId: string,
  opts: { reactivate?: boolean; linkUserId?: string | null } = {},
): Promise<number> {
  const order = await nextPlayerOrder(eventId);
  await prisma.player.update({
    where: { id: playerId },
    data: {
      order,
      ...(opts.reactivate ? { archivedAt: null } : {}),
      ...(opts.linkUserId ? { userId: opts.linkUserId } : {}),
    },
  });
  return order;
}

/**
 * Ensure the player is on the current Game's active roster (un-archiving a
 * previously left GameParticipant) and reset their Attendance to "yes".
 */
export async function rejoinPlayerToCurrentGame(
  gameId: string,
  eventPlayerId: string,
): Promise<void> {
  const order = await nextGameParticipantOrder(gameId);
  await upsertGameParticipantForRoster({ gameId, eventPlayerId, status: "active", order });
  await prisma.rsvp.upsert({
    where: { eventPlayerId_gameId: { eventPlayerId, gameId } },
    create: { eventPlayerId, gameId, status: "yes", respondedAt: new Date() },
    update: { status: "yes", respondedAt: new Date() },
  });
}

export interface LeaveTarget {
  playerId: string;
  name: string;
}

/** Whether the current Game's active roster still lists this EventPlayer. */
async function isOnCurrentRoster(eventId: string, eventPlayerId: string): Promise<boolean> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) return false;
  const participant = await prisma.gameParticipant.findFirst({
    where: { ...activeParticipantsWhere(event.currentGameId), eventPlayerId },
    select: { id: true },
  });
  return !!participant;
}

/** Restore the legacy Player row for someone the roster still lists (#1237).
 *  Returns null when the row belongs to a different account — never hijack it. */
async function repairPlayerRow(
  eventId: string,
  name: string,
  userId: string | null,
): Promise<string | null> {
  const existing = await prisma.player.findUnique({
    where: { eventId_name: { eventId, name } },
    select: { id: true, userId: true, archivedAt: true },
  });
  if (existing) {
    if (existing.userId && existing.userId !== userId) return null;
    if (!existing.archivedAt) return existing.id;
    await prisma.player.update({
      where: { id: existing.id },
      data: { archivedAt: null, ...(existing.userId ? {} : { userId }) },
    });
    return existing.id;
  }
  const created = await prisma.player.create({
    data: { eventId, name, userId, order: await nextPlayerOrder(eventId) },
  });
  return created.id;
}

/**
 * Resolve who a leave/remove request is about, so that anyone the event page
 * still lists can actually leave it (#1237).
 *
 * Roster membership is decided by GameParticipant (ADR 0016), but every leave and
 * remove path identifies a player by their legacy Player row. The reactivation
 * paths — accepting a re-invite, confirming a priority spot — put someone back on
 * the roster without clearing Player.archivedAt, or without a Player row at all.
 * The result was #1237: you appear on the list, and both the Leave button and the
 * x answer "you are not a player in this event", leaving no way off the list.
 *
 * Take the un-archived row when there is one; otherwise fall back to the
 * authoritative roster, repairing the Player row as a side effect. Returns null
 * only when the player is genuinely off the roster, so callers can still 404
 * someone who has really already left.
 */
export async function resolveLeaveTarget(
  eventId: string,
  opts: { userId: string } | { playerId: string },
): Promise<LeaveTarget | null> {
  // Fast path: an un-archived Player row is the historical gate, and still the
  // only membership signal on an event with no current Game.
  if ("userId" in opts) {
    const row = await prisma.player.findFirst({
      where: { eventId, userId: opts.userId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (row) return { playerId: row.id, name: row.name };
  } else {
    const row = await prisma.player.findFirst({
      where: { id: opts.playerId, eventId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (row) return { playerId: row.id, name: row.name };
  }

  // Slow path: the Player row is archived or absent, but the roster may still
  // list this player. Identify them, confirm that, then repair the row.
  let name: string;
  let userId: string | null;
  let eventPlayerId: string;

  if ("userId" in opts) {
    const eventPlayer = await prisma.eventPlayer.findFirst({
      where: { eventId, userId: opts.userId },
      select: { id: true, name: true },
    });
    if (!eventPlayer) return null;
    name = eventPlayer.name;
    userId = opts.userId;
    eventPlayerId = eventPlayer.id;
  } else {
    // The event GET hands out EventPlayer ids (ADR 0016), so accept either kind.
    const row = await prisma.player.findFirst({
      where: { id: opts.playerId, eventId },
      select: { name: true, userId: true },
    });
    const eventPlayer = await prisma.eventPlayer.findFirst({
      where: { id: opts.playerId, eventId },
      select: { id: true, name: true, userId: true },
    });
    if (row) {
      name = row.name;
      userId = row.userId;
    } else if (eventPlayer) {
      name = eventPlayer.name;
      userId = eventPlayer.userId;
    } else {
      return null;
    }
    const matched = await prisma.eventPlayer.findFirst({
      where: { eventId, name },
      select: { id: true },
    });
    if (!matched) return null;
    eventPlayerId = matched.id;
  }

  if (!(await isOnCurrentRoster(eventId, eventPlayerId))) return null;

  const repairedId = await repairPlayerRow(eventId, name, userId);
  return repairedId ? { playerId: repairedId, name } : null;
}
