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

export interface ActiveRosterState {
  /** Ordered non-archived roster (active + bench). Game-scoped when currentGameId is set. */
  members: RosterMember[];
  /** Names in the active slots (first maxPlayers members). */
  activeNames: Set<string>;
  /** Number of active players (capped at maxPlayers). */
  activeCount: number;
  /** Total non-archived roster size (active + bench). */
  totalCount: number;
  /** Name of the first bench player (member at index maxPlayers), null when the bench is empty. */
  firstBenchName: string | null;
  /** True when totalCount > maxPlayers. */
  hasBench: boolean;
}

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

/** Named for its 17 call sites; new code should call {@link getRosterCapacity}. */
export async function getActiveRosterState(
  eventId: string,
  maxPlayers: number,
  currentGameId?: string | null,
): Promise<ActiveRosterState> {
  const members = await fetchRosterMembers(eventId, currentGameId);
  const { active, bench } = splitRoster(members, maxPlayers);

  return {
    members,
    activeNames: new Set(active.map((m) => m.name)),
    activeCount: active.length,
    totalCount: members.length,
    firstBenchName: bench[0]?.name ?? null,
    hasBench: bench.length > 0,
  };
}
