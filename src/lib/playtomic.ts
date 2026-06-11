/**
 * Playtomic sport mapping utilities.
 * Pure functions safe for both client and server use.
 *
 * Valid Playtomic sport_id values: PADEL, TENNIS, FUTSAL, FOOTBALL7,
 * FOOTBALL_OTHERS, BADMINTON, SQUASH, PICKLEBALL.
 */

/**
 * Maps a Convocados sport ID to one or more Playtomic sport_id values.
 * Some sports map to multiple IDs because clubs register under different categories
 * (e.g. 5-a-side football appears as both FUTSAL and FOOTBALL_OTHERS).
 * Returns null for unsupported sports.
 */
export function mapSportToPlaytomic(sport: string): string | null {
  // Returns the PRIMARY id (used by most callers that accept a single sport).
  const primary = playtomicSportIds(sport);
  return primary ? primary[0] : null;
}

/** All Playtomic sport_id variants for a given Convocados sport (for broad search). */
export function playtomicSportIds(sport: string): string[] | null {
  const map: Record<string, string[]> = {
    "padel": ["PADEL"],
    "tennis-singles": ["TENNIS"],
    "tennis-doubles": ["TENNIS"],
    "football-5v5": ["FUTSAL", "FOOTBALL_OTHERS"],
    "football-7v7": ["FOOTBALL7"],
    "futsal": ["FUTSAL", "FOOTBALL_OTHERS"],
  };
  return map[sport] ?? null;
}

/** Returns true if the sport is supported by Playtomic search. */
export function isPlaytomicSport(sport: string): boolean {
  return playtomicSportIds(sport) !== null;
}
