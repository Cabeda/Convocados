/**
 * Match Events — the post-game timeline of a **Game** (ADR 0039).
 *
 * A Match Event is a Goal or an Assist recorded against a `GameHistory`.
 * For goal-scoring sports the team score is *derived* from the Goals once at
 * least one Match Event exists; when none exist, the manually entered score
 * stands. Set-based sports (tennis, padel) keep their set score and have no
 * Goals.
 */

export type MatchEventType = "goal" | "assist";
export type MatchEventTeam = "one" | "two" | "unknown";

/** The goal-scoring fields `deriveScoreFromGoals` needs. */
export interface GoalLike {
  team: MatchEventTeam | string;
  ownGoal: boolean;
  /**
   * How many goals this entry represents. A player who scored three from one
   * quick entry keeps a single row with `count: 3`, so the timeline stays short
   * and the score still adds up. Defaults to 1.
   */
  count?: number;
}

export interface DerivedScore {
  teamOne: number;
  teamTwo: number;
}

/** A count is only meaningful as a positive integer; anything else means one. */
function goalCount(goal: GoalLike): number {
  const n = goal.count;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Count the goals a team scored, crediting own goals to the opposing team.
 * Goals recorded with `team: "unknown"` never count.
 */
export function countGoalsForTeam(goals: GoalLike[], team: "one" | "two"): number {
  const opponent = team === "one" ? "two" : "one";
  let count = 0;
  for (const goal of goals) {
    if (goal.team === team && !goal.ownGoal) count += goalCount(goal);
    else if (goal.team === opponent && goal.ownGoal) count += goalCount(goal);
  }
  return count;
}

/**
 * Derive the team score from a game's Goals, or `null` when the game has no
 * usable Goals (in which case the manually entered score stands).
 */
export function deriveScoreFromGoals(goals: GoalLike[]): DerivedScore | null {
  const usable = goals.filter((goal) => goal.team === "one" || goal.team === "two");
  if (usable.length === 0) return null;
  return {
    teamOne: countGoalsForTeam(usable, "one"),
    teamTwo: countGoalsForTeam(usable, "two"),
  };
}
