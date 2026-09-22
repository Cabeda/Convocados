import { describe, it, expect } from "vitest";
import { deriveScoreFromGoals, countGoalsForTeam } from "~/lib/matchEvents";

describe("matchEvents — score derivation", () => {
  it("returns null derived score when there are no goals", () => {
    expect(deriveScoreFromGoals([])).toBeNull();
  });

  it("counts a simple goal for team one", () => {
    const derived = deriveScoreFromGoals([
      { team: "one", ownGoal: false },
      { team: "one", ownGoal: false },
      { team: "two", ownGoal: false },
    ]);
    expect(derived).toEqual({ teamOne: 2, teamTwo: 1 });
  });

  it("credits an own goal to the opposing team", () => {
    const derived = deriveScoreFromGoals([
      { team: "one", ownGoal: true },
      { team: "two", ownGoal: false },
    ]);
    expect(derived).toEqual({ teamOne: 0, teamTwo: 2 });
  });

  it("ignores goals with unknown team", () => {
    const derived = deriveScoreFromGoals([
      { team: "unknown", ownGoal: false },
      { team: "one", ownGoal: false },
    ]);
    expect(derived).toEqual({ teamOne: 1, teamTwo: 0 });
  });

  it("countGoalsForTeam mirrors deriveScoreFromGoals", () => {
    expect(countGoalsForTeam([{ team: "two", ownGoal: false }], "two")).toBe(1);
    expect(countGoalsForTeam([{ team: "one", ownGoal: true }], "two")).toBe(1);
    expect(countGoalsForTeam([{ team: "unknown", ownGoal: false }], "one")).toBe(0);
  });
});
