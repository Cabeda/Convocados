import { prisma } from "./db.server";
import { namesFromTeamsSnapshot, normalizeName } from "./snapshotParticipants";
import { occurrencePaymentNames } from "./paymentRoll.server";

export interface SettledGameParticipantContext {
  sessionUser: { id?: string; name?: string | null } | null;
  event: { id: string; dateTime: Date; currentGameId?: string | null };
  latestHistory: {
    teamsSnapshot: string | null;
    dateTime: Date;
  } | null;
}

/**
 * Whether the current user is a participant of the settled game, i.e. involved
 * in settling it (score, payments). A user counts if their name appears on the
 * settled game's teams or on its GamePayment roll (ADR 0016), or — when neither
 * has names yet for a just-ended game — on the played Game's participant list.
 * The live/next-game player list never counts on its own.
 *
 * Owner/Admin override is intentionally NOT handled here — callers decide
 * whether to grant settlement roles regardless of participation.
 */
export async function isSettledGameParticipant(context: SettledGameParticipantContext): Promise<boolean> {
  const { sessionUser, event, latestHistory } = context;
  const needle = normalizeName(sessionUser?.name);
  if (!needle) return false;

  // Payment names come from the occurrence's durable GamePayment roll, never
  // the frozen paymentsSnapshot (retarget: 5rhgs71k). Before a reset the
  // settled occurrence is the live currentGameId (its Game.dateTime can drift
  // from Event.dateTime after a datetime edit); after a reset it is the game
  // matching the latest history's dateTime.
  const occurrenceDt = latestHistory?.dateTime ?? event.dateTime;
  const hasReset = !!latestHistory && event.dateTime.getTime() > latestHistory.dateTime.getTime();
  const paymentNames = await occurrencePaymentNames(
    event.id,
    occurrenceDt,
    hasReset ? undefined : event.currentGameId,
  );

  const snapshotNames = new Set(
    [
      ...namesFromTeamsSnapshot(latestHistory?.teamsSnapshot),
      ...paymentNames,
    ].map(normalizeName),
  );
  if (snapshotNames.has(needle)) return true;

  // No names for the settled game yet (one-off just ended, or the reset hasn't
  // materialised teams) → fall back to the settled Game's own participants,
  // which still belong to that game.
  if (snapshotNames.size === 0) {
    const noNamesForSettledGame = !latestHistory
      || latestHistory.dateTime.getTime() === event.dateTime.getTime();
    if (!noNamesForSettledGame) return false;

    const settledGame = event.currentGameId
      ? await prisma.game.findFirst({
          where: { id: event.currentGameId, eventId: event.id },
          include: {
            participants: {
              where: { archivedAt: null, status: { not: "pending" } },
              include: { eventPlayer: { select: { name: true, userId: true } } },
            },
          },
        })
      : await prisma.game.findFirst({
          where: { eventId: event.id, dateTime: event.dateTime },
          include: {
            participants: {
              where: { archivedAt: null, status: { not: "pending" } }, // same as activeParticipantsWhere — nested relation has no gameId
              include: { eventPlayer: { select: { name: true, userId: true } } },
            },
          },
        });
    if (settledGame?.participants.some((p) => p.eventPlayer.userId === sessionUser?.id)) {
      return true;
    }

    const fallbackNames = settledGame?.participants.map((p) => p.eventPlayer.name) ?? [];
    return fallbackNames.some((n) => normalizeName(n) === needle);
  }

  return false;
}
