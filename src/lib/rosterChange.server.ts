/**
 * Roster change helpers — the repeated steps of re-adding a player to the
 * current Game. Extracted from the players route so the "queue semantics"
 * (a re-join goes to the end of the list) and the "re-join resets Attendance"
 * rule live in one place instead of three near-identical copies.
 */
import { prisma } from "./db.server";
import { nextGameParticipantOrder } from "./game.server";
import { upsertGameParticipantForRoster } from "./rosterCore.server";

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
