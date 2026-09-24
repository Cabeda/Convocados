import { prisma } from "./db.server";
import { namesFromTeamsSnapshot } from "./snapshotParticipants";
import { activeParticipantsWhere } from "./activeParticipants.server";

export interface RosterOccurrence {
  /** Game id when a Game row exists for the occurrence, else null. */
  gameId: string | null;
  /** Player names who played, in order. GP-first, snapshot fallback. */
  names: string[];
  /** True when the names came from GameParticipant (durable), false = snapshot residue. */
  fromGame: boolean;
}

/**
 * Who-played names for one occurrence (ADR 0016 / mrcokrf9).
 *
 * Prefers the durable `GameParticipant` rows (joined to EventPlayer) and falls
 * back to the frozen `GameHistory.teamsSnapshot` for pre-backfill rows. Keyed
 * by game id when known, else by matching the occurrence dateTime.
 */
export async function occurrenceRoster(
  eventId: string,
  occurrence: { gameId?: string | null; dateTime?: Date | null; teamsSnapshot?: string | null },
): Promise<RosterOccurrence> {
  const game = occurrence.gameId
    ? await prisma.game.findFirst({
        where: { id: occurrence.gameId, eventId },
        select: { id: true },
      })
    : occurrence.dateTime
      ? await prisma.game.findFirst({
          where: { eventId, dateTime: occurrence.dateTime },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      : null;

  if (game) {
    const participants = await prisma.gameParticipant.findMany({
      where: activeParticipantsWhere(game.id),
      orderBy: { order: "asc" },
      select: { eventPlayer: { select: { name: true } } },
    });
    if (participants.length > 0) {
      return { gameId: game.id, names: participants.map((p) => p.eventPlayer.name), fromGame: true };
    }
    // Game exists but nobody recorded — fall through to snapshot residue.
    return { gameId: game.id, names: namesFromTeamsSnapshot(occurrence.teamsSnapshot), fromGame: false };
  }

  return { gameId: null, names: namesFromTeamsSnapshot(occurrence.teamsSnapshot), fromGame: false };
}

/** Batch variant: names per occurrence, keyed by the caller's own key. */
export async function occurrenceRosterNamesMap<K extends string>(
  eventId: string,
  occurrences: Array<{
    key: K;
    gameId?: string | null;
    dateTime?: Date | null;
    teamsSnapshot?: string | null;
  }>,
): Promise<Map<K, string[]>> {
  const out = new Map<K, string[]>();
  for (const o of occurrences) {
    const roster = await occurrenceRoster(eventId, o);
    out.set(o.key, roster.names);
  }
  return out;
}

/**
 * Attach durable who-played names (GameParticipant) to history-shaped rows,
 * snapshot residue as fallback (mrcokrf9).
 */
export async function withRosterNames<T extends { id: string; dateTime: Date; teamsSnapshot: string | null }>(
  eventId: string,
  history: T[],
): Promise<Array<T & { playerNames: string[] }>> {
  const namesById = await occurrenceRosterNamesMap(
    eventId,
    history.map((h) => ({ key: h.id, dateTime: h.dateTime, teamsSnapshot: h.teamsSnapshot })),
  );
  return history.map((h) => ({ ...h, playerNames: namesById.get(h.id) ?? [] }));
}
