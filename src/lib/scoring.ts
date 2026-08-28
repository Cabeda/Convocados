export type ScoringType = "standard" | "tennis";

export interface SetScore {
  teamOne: number;
  teamTwo: number;
  tiebreakTeamOne?: number;
  tiebreakTeamTwo?: number;
}

const TENNIS_SPORTS = new Set(["tennis", "tennis-singles", "tennis-doubles", "padel"]);

export function getScoringType(sport: string | null | undefined): ScoringType {
  return sport && TENNIS_SPORTS.has(sport.toLowerCase()) ? "tennis" : "standard";
}

export function validateScoreSets(value: unknown): string[] {
  if (!Array.isArray(value)) return ["Score sets must be an array."];
  if (value.length > 5) return ["A match cannot contain more than five sets."];

  const errors: string[] = [];
  for (const set of value) {
    if (!set || typeof set !== "object") {
      errors.push("Each set must be an object.");
      continue;
    }
    const score = set as Record<string, unknown>;
    if (!isNonNegativeInteger(score.teamOne) || !isNonNegativeInteger(score.teamTwo)) {
      errors.push("Set scores must be non-negative integers.");
    }
    const hasTiebreakOne = score.tiebreakTeamOne !== undefined && score.tiebreakTeamOne !== null;
    const hasTiebreakTwo = score.tiebreakTeamTwo !== undefined && score.tiebreakTeamTwo !== null;
    if (hasTiebreakOne !== hasTiebreakTwo) {
      errors.push("Tiebreak scores must be provided together.");
    } else if ((hasTiebreakOne && !isNonNegativeInteger(score.tiebreakTeamOne)) || (hasTiebreakTwo && !isNonNegativeInteger(score.tiebreakTeamTwo))) {
      errors.push("Tiebreak scores must be non-negative integers.");
    }
  }
  return [...new Set(errors)];
}

export function parseScoreSets(value: string | null | undefined): SetScore[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return validateScoreSets(parsed).length === 0 ? parsed as SetScore[] : null;
  } catch {
    return null;
  }
}

export function serializeScoreSets(sets: SetScore[]): string {
  return JSON.stringify(sets);
}

export function parseScalarScore(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (isNonNegativeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return isNonNegativeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function hasCompletedSet(sets: SetScore[]): boolean {
  return sets.some(isCompletedSet);
}

/** A structured score is final only when every recorded set is complete. */
export function hasCompletedMatch(sets: SetScore[]): boolean {
  return sets.length > 0 && sets.every(isCompletedSet);
}

export function matchScoreFromSets(sets: SetScore[]): { teamOne: number; teamTwo: number } {
  return sets.reduce(
    (score, set) => {
      const hasTiebreak = set.tiebreakTeamOne !== undefined && set.tiebreakTeamOne !== null && set.tiebreakTeamTwo !== undefined && set.tiebreakTeamTwo !== null;
      const tiebreakComplete = hasTiebreak && isCompletedTiebreak(set.tiebreakTeamOne!, set.tiebreakTeamTwo!);
      if (!isCompletedSet(set)) return score;
      const teamOneWon = tiebreakComplete ? set.tiebreakTeamOne! > set.tiebreakTeamTwo! : set.teamOne > set.teamTwo;
      const teamTwoWon = tiebreakComplete ? set.tiebreakTeamTwo! > set.tiebreakTeamOne! : set.teamTwo > set.teamOne;
      if (teamOneWon) return { ...score, teamOne: score.teamOne + 1 };
      if (teamTwoWon) return { ...score, teamTwo: score.teamTwo + 1 };
      return score;
    },
    { teamOne: 0, teamTwo: 0 },
  );
}

export function formatSetScore(set: SetScore): string {
  const base = `${set.teamOne}-${set.teamTwo}`;
  if (set.tiebreakTeamOne === undefined || set.tiebreakTeamOne === null || set.tiebreakTeamTwo === undefined || set.tiebreakTeamTwo === null) {
    return base;
  }
  return `${base} (${set.tiebreakTeamOne}-${set.tiebreakTeamTwo})`;
}

function isCompletedSet(set: SetScore): boolean {
  if (set.tiebreakTeamOne !== undefined && set.tiebreakTeamOne !== null && set.tiebreakTeamTwo !== undefined && set.tiebreakTeamTwo !== null) {
    return isCompletedTiebreak(set.tiebreakTeamOne, set.tiebreakTeamTwo);
  }
  const high = Math.max(set.teamOne, set.teamTwo);
  const difference = Math.abs(set.teamOne - set.teamTwo);
  return high >= 6 && (difference >= 2 || high >= 7);
}

function isCompletedTiebreak(teamOne: number, teamTwo: number): boolean {
  return Math.max(teamOne, teamTwo) >= 7 && Math.abs(teamOne - teamTwo) >= 2;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
