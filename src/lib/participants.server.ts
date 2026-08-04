import { prisma } from "./db.server";
import {
  namesFromPaymentsSnapshot,
  namesFromTeamsSnapshot,
  normalizeName,
} from "./snapshotParticipants";

export interface SettledGameParticipantContext {
  sessionUser: { id?: string; name?: string | null } | null;
  event: { id: string; dateTime: Date };
  latestHistory: {
    teamsSnapshot: string | null;
    paymentsSnapshot: string | null;
    dateTime: Date;
  } | null;
  pastGameSource: "snapshot" | "live" | "none";
  eventCost?: { payments: Array<{ playerName: string }> } | null;
}

/**
 * Whether the current user is a participant of the settled game, i.e. involved
 * in settling it (score, payments). A user counts if their name appears on the
 * settled game's teams or payment roll (snapshot), or — when no snapshot exists
 * yet for a just-ended game — on the played Game's participant list or its live
 * payment roll. The live/next-game player list never counts on its own.
 *
 * Owner/Admin override is intentionally NOT handled here — callers decide
 * whether to grant settlement roles regardless of participation.
 */
export async function isSettledGameParticipant(context: SettledGameParticipantContext): Promise<boolean> {
  const { sessionUser, event, latestHistory, pastGameSource, eventCost } = context;
  const needle = normalizeName(sessionUser?.name);
  if (!needle) return false;

  const snapshotNames = new Set(
    [
      ...namesFromTeamsSnapshot(latestHistory?.teamsSnapshot),
      ...namesFromPaymentsSnapshot(latestHistory?.paymentsSnapshot),
    ].map(normalizeName),
  );
  if (snapshotNames.has(needle)) return true;

  // No snapshot with names for the settled game yet (one-off just ended, or the
  // reset hasn't materialised a snapshot) → fall back to the settled Game's own
  // participants and its live payment roll, which still belong to that game.
  if (snapshotNames.size === 0) {
    const noSnapshotForSettledGame = !latestHistory
      || latestHistory.dateTime.getTime() === event.dateTime.getTime();
    if (!noSnapshotForSettledGame) return false;

    const settledGame = await prisma.game.findFirst({
      where: { eventId: event.id, dateTime: event.dateTime },
      include: {
        participants: {
          where: { archivedAt: null },
          include: { eventPlayer: { select: { name: true, userId: true } } },
        },
      },
    });
    if (settledGame?.participants.some((p) => p.eventPlayer.userId === sessionUser?.id)) {
      return true;
    }

    const fallbackNames = [
      ...(settledGame?.participants.map((p) => p.eventPlayer.name) ?? []),
      ...(pastGameSource === "live" && eventCost?.payments
        ? eventCost.payments.map((p) => p.playerName)
        : []),
    ];
    return fallbackNames.some((n) => normalizeName(n) === needle);
  }

  return false;
}
