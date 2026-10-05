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

/**
 * The active roster row behind this EventPlayer id, or null.
 *
 * A pending invite ghost is not on the roster (ADR 0025) — it is retracted by its own
 * action, not by the x on the roster — so the roster routes must not act on one.
 */
export async function activeRosterEventPlayerById(eventId: string, eventPlayerId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) return null;
  const participant = await prisma.gameParticipant.findFirst({
    where: { ...activeParticipantsWhere(event.currentGameId), eventPlayerId, eventPlayer: { eventId } },
    select: { eventPlayer: { select: { id: true, name: true, userId: true } } },
  });
  return participant?.eventPlayer ?? null;
}

/**
 * The EventPlayer row an account is currently listed under, or null.
 *
 * EventPlayer is unique on (eventId, name) — *not* on userId — so one account can
 * own two rows: priority/confirm upserts by name using the caller's *current*
 * display name and leaves the row from their previous name behind. An unordered
 * findFirst can land on that ghost, and acting on the ghost leaves the player still
 * on the list — #1237's symptom one indirection away. Prefer the row the current
 * Game actually lists.
 */
export async function rosteredEventPlayerForUser(eventId: string, userId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (event?.currentGameId) {
    const participant = await prisma.gameParticipant.findFirst({
      where: { ...activeParticipantsWhere(event.currentGameId), eventPlayer: { eventId, userId } },
      select: { eventPlayer: { select: { id: true, name: true } } },
    });
    if (participant) return participant.eventPlayer;
  }
  return prisma.eventPlayer.findFirst({ where: { eventId, userId }, select: { id: true, name: true } });
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
  const maxOrder = await prisma.player.aggregate({
    where: { eventId, archivedAt: null },
    _max: { order: true },
  });
  const order = (maxOrder._max.order ?? -1) + 1;
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
