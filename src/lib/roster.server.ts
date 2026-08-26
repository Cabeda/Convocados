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
 */
import { prisma } from "./db.server";
import { activeParticipantsWhere } from "./activeParticipants.server";

export interface RosterMember {
  name: string;
  userId: string | null;
}

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

export async function getActiveRosterState(
  eventId: string,
  maxPlayers: number,
  currentGameId?: string | null,
): Promise<ActiveRosterState> {
  let members: RosterMember[];
  if (currentGameId) {
    // ADR 0025: pending invite participants (status="pending") are roster
    // ghosts — visible as "invited" only, never part of the active/bench math.
    // The event GET endpoint applies the same filter; this shared helper must
    // agree with it or joins get marked "bench" and team sync silently skips.
    const participants = await prisma.gameParticipant.findMany({
      where: activeParticipantsWhere(currentGameId),
      include: { eventPlayer: { select: { name: true, userId: true } } },
      orderBy: { order: "asc" },
    });
    members = participants.map((gp) => ({ name: gp.eventPlayer.name, userId: gp.eventPlayer.userId }));
  } else {
    const players = await prisma.player.findMany({
      where: { eventId, archivedAt: null },
      orderBy: { order: "asc" },
      select: { name: true, userId: true },
    });
    members = players.map((p) => ({ name: p.name, userId: p.userId }));
  }

  const names = members.map((m) => m.name);
  return {
    members,
    activeNames: new Set(names.slice(0, maxPlayers)),
    activeCount: Math.min(names.length, maxPlayers),
    totalCount: names.length,
    firstBenchName: names[maxPlayers] ?? null,
    hasBench: names.length > maxPlayers,
  };
}