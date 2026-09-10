export interface FormationSlot {
  /** Depth within the team's own half: 0 = own goal line, 1 = halfway line. */
  x: number;
  /** Width across the team's half: 0 = top touchline, 1 = bottom touchline. */
  y: number;
}

export interface Formation {
  /** Human-readable id, e.g. "4-3-3". Also used as the persisted value. */
  id: string;
  slots: FormationSlot[];
}

/**
 * Turns a row shape like [4, 3, 3] into normalized slots, laid out from the
 * team's own goal (first row) toward the halfway line (last row).
 */
function rowsToSlots(rows: number[]): FormationSlot[] {
  const slots: FormationSlot[] = [];
  const rowCount = rows.length;
  rows.forEach((count, rowIdx) => {
    const x = rowCount === 1 ? 0.5 : 0.15 + (rowIdx / (rowCount - 1)) * 0.7;
    for (let i = 0; i < count; i++) {
      const y = count === 1 ? 0.5 : 0.12 + (i / (count - 1)) * 0.76;
      slots.push({ x, y });
    }
  });
  return slots;
}

function formation(id: string, rows: number[]): Formation {
  return { id, slots: rowsToSlots(rows) };
}

const SPORT_FORMATIONS: Record<string, Formation[]> = {
  // Rows include the goalkeeper first; the id is the conventional outfield shape.
  "football-5v5": [
    formation("2-2", [1, 2, 2]),
    formation("1-2-1", [1, 1, 2, 1]),
    formation("3-1", [1, 3, 1]),
  ],
  "football-7v7": [
    formation("2-3-1", [1, 2, 3, 1]),
    formation("3-2-1", [1, 3, 2, 1]),
    formation("2-2-2", [1, 2, 2, 2]),
  ],
  "football-11v11": [
    formation("4-4-2", [1, 4, 4, 2]),
    formation("4-3-3", [1, 4, 3, 3]),
    formation("4-2-4", [1, 4, 2, 4]),
    formation("3-5-2", [1, 3, 5, 2]),
    formation("4-5-1", [1, 4, 5, 1]),
  ],
  futsal: [
    formation("2-2", [1, 2, 2]),
    formation("1-2-1", [1, 1, 2, 1]),
    formation("3-1", [1, 3, 1]),
  ],
  basketball: [
    formation("2-1-2", [2, 1, 2]),
    formation("1-2-2", [1, 2, 2]),
    formation("2-2-1", [2, 2, 1]),
  ],
  volleyball: [
    formation("3-3", [3, 3]),
    formation("2-2-2", [2, 2, 2]),
  ],
  padel: [formation("2", [2])],
  "tennis-doubles": [formation("2", [2])],
  "badminton-doubles": [formation("2", [2])],
  pickleball: [formation("2-2", [2, 2])],
  "tennis-singles": [formation("1", [1])],
  "badminton-singles": [formation("1", [1])],
  squash: [formation("1", [1])],
  other: [
    formation("2-2-1", [2, 2, 1]),
    formation("2-1-2", [2, 1, 2]),
  ],
};

const FALLBACK = SPORT_FORMATIONS.other;

/** Formations available for a sport. Falls back to a generic set. */
export function getFormationsForSport(sportId: string | null | undefined): Formation[] {
  return (sportId && SPORT_FORMATIONS[sportId]) || FALLBACK;
}

/** Look up a specific formation for a sport. Returns undefined when unknown. */
export function getFormation(
  sportId: string | null | undefined,
  formationId: string | null | undefined,
): Formation | undefined {
  if (!formationId) return undefined;
  return getFormationsForSport(sportId).find((f) => f.id === formationId);
}

/** The first formation for a sport — used when a team has none selected yet. */
export function getDefaultFormation(sportId: string | null | undefined): Formation {
  return getFormationsForSport(sportId)[0];
}
