/**
 * Playtomic sport mapping utilities.
 * Pure functions safe for both client and server use.
 *
 * Valid Playtomic sport_id values: PADEL, TENNIS, FUTSAL, FOOTBALL7,
 * BADMINTON, SQUASH, PICKLEBALL.
 */

/** Maps Convocados sport IDs to Playtomic sport IDs. Returns null for unsupported sports. */
export function mapSportToPlaytomic(sport: string): string | null {
  const map: Record<string, string> = {
    "padel": "PADEL",
    "tennis-singles": "TENNIS",
    "tennis-doubles": "TENNIS",
    "football-5v5": "FUTSAL",
    "football-7v7": "FOOTBALL7",
    "futsal": "FUTSAL",
  };
  return map[sport] ?? null;
}

/** Returns true if the sport is supported by Playtomic search. */
export function isPlaytomicSport(sport: string): boolean {
  return mapSportToPlaytomic(sport) !== null;
}
