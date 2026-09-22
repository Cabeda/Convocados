import { describe, it, expect } from "vitest";
import { deriveScoreFromGoals, countGoalsForTeam, type GoalLike } from "~/lib/matchEvents";

/** A goal entry with a quantity, mirroring `MatchEvent.count`. */
const g = (team: GoalLike["team"], ownGoal = false, count = 1): GoalLike => ({ team, ownGoal, count });

describe("matchEvents — score derivation with counts", () => {
  it("treats a missing count as one goal", () => {
    expect(deriveScoreFromGoals([{ team: "one", ownGoal: false }])).toEqual({ teamOne: 1, teamTwo: 0 });
  });

  it("sums the count of each entry", () => {
    expect(deriveScoreFromGoals([g("one", false, 3), g("two", false, 2)])).toEqual({ teamOne: 3, teamTwo: 2 });
  });

  it("credits counted own goals to the opposing side", () => {
    // Two own goals by team one give team two two goals; team two then scores
    // one of their own. Team one gets nothing.
    expect(deriveScoreFromGoals([g("one", true, 2), g("two", false, 1)])).toEqual({ teamOne: 0, teamTwo: 3 });
  });

  it("ignores unknown teams even with a count", () => {
    expect(deriveScoreFromGoals([g("unknown", false, 5), g("one", false, 1)])).toEqual({ teamOne: 1, teamTwo: 0 });
  });

  it("returns null when there are no usable goals", () => {
    expect(deriveScoreFromGoals([])).toBeNull();
    expect(deriveScoreFromGoals([g("unknown", false, 4)])).toBeNull();
  });

  it("countGoalsForTeam sums counts for the side", () => {
    expect(countGoalsForTeam([g("two", false, 3), g("one", true, 2)], "two")).toBe(5);
    expect(countGoalsForTeam([g("one", false, 2)], "two")).toBe(0);
  });

  it("replaces the manual score even with a single bulk entry", () => {
    // One row carrying 20 goals must count as 20, not 1.
    expect(deriveScoreFromGoals([g("one", false, 20)])).toEqual({ teamOne: 20, teamTwo: 0 });
  });
});
