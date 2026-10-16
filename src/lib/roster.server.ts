/**
 * Shared "active roster for the current game" accessor.
 *
 * ADR 0016: the current game's GameParticipant rows are the authoritative
 * roster. Legacy Player rows accumulate across recurring occurrences and would
 * inflate any active/bench/spotsLeft computation, so every path that answers
 * "how many players / who is on the bench / how many spots are left" must go
 * through this single helper instead of re-deriving GameParticipant vs Player
 * logic locally. The join path (players.ts) and the leave path (leave.server.ts)
 * used to compute this independently — the duplication was how #722 (player_left
 * always reporting spotsLeft: 0 on recurring events) slipped through.
 *
 * The active/bench split and the capacity arithmetic are not defined here — they
 * live in `rosterCapacity.splitRoster`, which both entry points below call, so the
 * query form (`getRosterCapacity`) and the in-memory form (`splitRoster`, for
 * surfaces that already hold the roster as an array) cannot disagree.
 */
import { prisma } from "./db.server";
import { activeParticipantsWhere } from "./activeParticipants.server";
import { splitRoster, type RosterSplit } from "./rosterCapacity";

export interface RosterMember {
  name: string;
  userId: string | null;
}

/** Active/bench membership and remaining capacity for an Event's current Game. */
export type RosterCapacity = RosterSplit<RosterMember>;

/**
 * The Event's Roster as members, already filtered: archived rows out, invite
 * ghosts (`status === "pending"`, ADR 0025) out, and legacy Player rows read only
 * when there is no current Game to scope to.
 */
async function fetchRosterMembers(
  eventId: string,
  currentGameId?: string | null,
): Promise<RosterMember[]> {
  if (currentGameId) {
    const participants = await prisma.gameParticipant.findMany({
      where: activeParticipantsWhere(currentGameId),
      include: { eventPlayer: { select: { name: true, userId: true } } },
      orderBy: { order: "asc" },
    });
    return participants.map((gp) => ({ name: gp.eventPlayer.name, userId: gp.eventPlayer.userId }));
  }

  const players = await prisma.player.findMany({
    where: { eventId, archivedAt: null },
    orderBy: { order: "asc" },
    select: { name: true, userId: true },
  });
  return players.map((p) => ({ name: p.name, userId: p.userId }));
}

/**
 * Active count, bench count, spots left and whether a bench exists, for an Event's
 * current Game. This is the entry point for anything that has to fetch the roster;
 * callers that already hold it as an array call `splitRoster` directly and get the
 * same answer.
 */
export async function getRosterCapacity(
  eventId: string,
  maxPlayers: number,
  currentGameId?: string | null,
): Promise<RosterCapacity> {
  return splitRoster(await fetchRosterMembers(eventId, currentGameId), maxPlayers);
}
