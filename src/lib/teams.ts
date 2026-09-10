import type { Imatch, Player } from "./random";
import { getDefaultFormation, getFormation } from "./formations";

function reindex(players: Player[]): Player[] {
  return players.map((p, i) => ({ ...p, order: i }));
}

function slotsNotIn(taken: Set<number>, slotCount: number): number[] {
  const free: number[] = [];
  for (let i = 0; i < slotCount; i++) if (!taken.has(i)) free.push(i);
  return free;
}

/**
 * Move a player from one team to another, returning a new `Imatch[]` with
 * `order` values reindexed. Returns the original array unchanged when the move
 * is a no-op (same team, unknown player, or unknown destination).
 *
 * The moved player loses any formation slot — the server re-fills slots from
 * the formation when the teams are saved.
 */
export function movePlayer(
  matches: Imatch[],
  playerName: string,
  fromTeam: string,
  toTeam: string,
): Imatch[] {
  if (fromTeam === toTeam) return matches;

  const source = matches.find((m) => m.team === fromTeam);
  if (!source || !source.players.some((p) => p.name === playerName)) return matches;

  if (!matches.some((m) => m.team === toTeam)) return matches;

  return matches.map((m) => {
    if (m.team === fromTeam) {
      return { ...m, players: reindex(m.players.filter((p) => p.name !== playerName)) };
    }
    if (m.team === toTeam) {
      const players = [...m.players, { name: playerName, order: m.players.length, slot: null }];
      return { ...m, players: reindex(players) };
    }
    return m;
  });
}

/**
 * Place a player into a specific formation slot. Within one team this swaps
 * with the current occupant (if any). Across teams it moves the player to the
 * target slot and sends the displaced occupant back to the source team's
 * vacated slot — a cross-team swap.
 *
 * Returns the original array when the player or a team is unknown.
 */
export function placePlayer(
  matches: Imatch[],
  playerName: string,
  fromTeam: string,
  toTeam: string,
  toSlot: number,
): Imatch[] {
  const source = matches.find((m) => m.team === fromTeam);
  const target = matches.find((m) => m.team === toTeam);
  if (!source || !target) return matches;
  const sourcePlayer = source.players.find((p) => p.name === playerName);
  if (!sourcePlayer) return matches;

  if (fromTeam === toTeam) {
    const occupant = source.players.find((p) => p.slot === toSlot && p.name !== playerName);
    const vacated = sourcePlayer.slot ?? null;
    return matches.map((m) => {
      if (m.team !== fromTeam) return m;
      const players = m.players.map((p) => {
        if (p.name === playerName) return { ...p, slot: toSlot };
        if (occupant && p.name === occupant.name) return { ...p, slot: vacated };
        return p;
      });
      return { ...m, players };
    });
  }

  const occupant = target.players.find((p) => p.slot === toSlot);
  const vacatedSlot = sourcePlayer.slot ?? null;

  return matches.map((m) => {
    if (m.team === fromTeam) {
      let players = m.players.filter((p) => p.name !== playerName);
      if (occupant) players = [...players, { name: occupant.name, order: 0, slot: vacatedSlot }];
      return { ...m, players: reindex(players) };
    }
    if (m.team === toTeam) {
      let players = occupant ? m.players.filter((p) => p.name !== occupant.name) : m.players;
      players = [...players, { name: playerName, order: 0, slot: toSlot }];
      return { ...m, players: reindex(players) };
    }
    return m;
  });
}

/**
 * Change a team's formation and reassign its players to slots in their current
 * slot order (unplaced players keep their relative order). Players beyond the
 * new slot count become unplaced (`slot: null`).
 */
export function setFormation(
  matches: Imatch[],
  team: string,
  formationId: string,
  slotCount: number,
): Imatch[] {
  return matches.map((m) => {
    if (m.team !== team) return m;
    const ordered = [...m.players].sort((a, b) => {
      const as = a.slot ?? Number.MAX_SAFE_INTEGER;
      const bs = b.slot ?? Number.MAX_SAFE_INTEGER;
      return as - bs || a.order - b.order;
    });
    const slotByName = new Map<string, number | null>();
    ordered.forEach((p, i) => slotByName.set(p.name, i < slotCount ? i : null));
    const players = m.players.map((p) => ({ ...p, slot: slotByName.get(p.name) ?? null }));
    return { ...m, formation: formationId, players };
  });
}

/**
 * Keep valid, unique slots and fill the remaining slots by `order`. Used
 * server-side so any client (including the list view) lands on a coherent
 * formation layout. Returns a new array; does not mutate the input.
 */
export function normalizeSlots(players: Player[], slotCount: number): Player[] {
  const result = players.map((p) => ({ ...p }));
  const taken = new Set<number>();

  for (const p of result) {
    if (typeof p.slot === "number" && p.slot >= 0 && p.slot < slotCount && !taken.has(p.slot)) {
      taken.add(p.slot);
    } else {
      p.slot = null;
    }
  }

  const free = slotsNotIn(taken, slotCount);

  const unplaced = result
    .filter((p) => p.slot === null)
    .sort((a, b) => a.order - b.order);
  unplaced.forEach((p, i) => {
    p.slot = free[i] ?? null;
  });

  return result;
}

/**
 * First unoccupied slot index for a team, or null when every slot is taken.
 */
export function firstFreeSlot(players: Player[], slotCount: number): number | null {
  const used = new Set(
    players.map((p) => p.slot).filter((s): s is number => typeof s === "number"),
  );
  return slotsNotIn(used, slotCount)[0] ?? null;
}

/**
 * Resolve each team's formation (honouring a valid requested one, else the
 * sport default) and lay its players out on the formation slots. Server-side
 * entry point so every writer produces a coherent layout.
 */
export function applyFormationLayout(matches: Imatch[], sportId: string | null): Imatch[] {
  const fallback = getDefaultFormation(sportId);
  return matches.map((m) => {
    const formation = getFormation(sportId, m.formation) ?? fallback;
    return {
      ...m,
      formation: formation.id,
      players: normalizeSlots(m.players, formation.slots.length),
    };
  });
}
