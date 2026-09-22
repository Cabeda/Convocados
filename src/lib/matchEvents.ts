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
}

export interface DerivedScore {
  teamOne: number;
  teamTwo: number;
}

/**
 * Count the goals a team scored, crediting own goals to the opposing team.
 * Goals recorded with `team: "unknown"` never count.
 */
export function countGoalsForTeam(goals: GoalLike[], team: "one" | "two"): number {
  const opponent = team === "one" ? "two" : "one";
  let count = 0;
  for (const goal of goals) {
    if (goal.team === team && !goal.ownGoal) count += 1;
    else if (goal.team === opponent && goal.ownGoal) count += 1;
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
