import type { Imatch } from "./random";

/**
 * Move a player from one team to another, returning a new `Imatch[]` with
 * `order` values reindexed. Returns the original array unchanged when the move
 * is a no-op (same team, unknown player, or unknown destination).
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
      const players = m.players
        .filter((p) => p.name !== playerName)
        .map((p, i) => ({ ...p, order: i }));
      return { ...m, players };
    }
    if (m.team === toTeam) {
      const players = [...m.players, { name: playerName, order: m.players.length }].map(
        (p, i) => ({ ...p, order: i }),
      );
      return { ...m, players };
    }
    return m;
  });
}
