import { describe, expect, it } from "vitest";
import {
  formatSetScore,
  getScoringType,
  hasCompletedMatch,
  hasCompletedSet,
  matchScoreFromSets,
  parseScalarScore,
  parseScoreSets,
  type SetScore,
  validateScoreSets,
} from "~/lib/scoring";

describe("scoring domain", () => {
  it("uses tennis scoring for tennis and padel sports", () => {
    expect(getScoringType("tennis-singles")).toBe("tennis");
    expect(getScoringType("tennis-doubles")).toBe("tennis");
    expect(getScoringType("padel")).toBe("tennis");
    expect(getScoringType("football-5v5")).toBe("standard");
  });

  it("counts completed sets while ignoring an in-progress set", () => {
    const sets: SetScore[] = [
      { teamOne: 6, teamTwo: 4 },
      { teamOne: 3, teamTwo: 2 },
      { teamOne: 7, teamTwo: 6, tiebreakTeamOne: 7, tiebreakTeamTwo: 5 },
    ];

    expect(matchScoreFromSets(sets)).toEqual({ teamOne: 2, teamTwo: 0 });
  });

  it("uses tiebreak points to determine the winner of a tied set", () => {
    expect(matchScoreFromSets([{ teamOne: 6, teamTwo: 6, tiebreakTeamOne: 7, tiebreakTeamTwo: 5 }])).toEqual({ teamOne: 1, teamTwo: 0 });
    expect(matchScoreFromSets([{ teamOne: 6, teamTwo: 6, tiebreakTeamOne: 4, tiebreakTeamTwo: 7 }])).toEqual({ teamOne: 0, teamTwo: 1 });
  });

  it("does not count an unfinished tiebreak as a completed set", () => {
    expect(matchScoreFromSets([{ teamOne: 6, teamTwo: 6, tiebreakTeamOne: 0, tiebreakTeamTwo: 0 }])).toEqual({ teamOne: 0, teamTwo: 0 });
    expect(matchScoreFromSets([{ teamOne: 6, teamTwo: 6, tiebreakTeamOne: 1, tiebreakTeamTwo: 0 }])).toEqual({ teamOne: 0, teamTwo: 0 });
  });

  it("recognizes completed sets without counting in-progress scores", () => {
    expect(hasCompletedSet([])).toBe(false);
    expect(hasCompletedSet([{ teamOne: 3, teamTwo: 2 }])).toBe(false);
    expect(hasCompletedSet([{ teamOne: 6, teamTwo: 6, tiebreakTeamOne: 1, tiebreakTeamTwo: 0 }])).toBe(false);
    expect(hasCompletedSet([{ teamOne: 6, teamTwo: 6, tiebreakTeamOne: 7, tiebreakTeamTwo: 5 }])).toBe(true);
    expect(hasCompletedMatch([])).toBe(false);
    expect(hasCompletedMatch([{ teamOne: 6, teamTwo: 4 }, { teamOne: 3, teamTwo: 2 }])).toBe(false);
    expect(hasCompletedMatch([{ teamOne: 6, teamTwo: 4 }, { teamOne: 6, teamTwo: 2 }])).toBe(true);
    expect(hasCompletedMatch([{ teamOne: 6, teamTwo: 4 }, { teamOne: 0, teamTwo: 0 }])).toBe(false);
  });

  it("formats a set with its tiebreak when one is recorded", () => {
    expect(formatSetScore({ teamOne: 7, teamTwo: 6, tiebreakTeamOne: 8, tiebreakTeamTwo: 6 })).toBe("7-6 (8-6)");
    expect(formatSetScore({ teamOne: 6, teamTwo: 4 })).toBe("6-4");
  });

  it("validates set scores and rejects malformed tiebreaks", () => {
    expect(validateScoreSets([{ teamOne: 6, teamTwo: 4 }])).toEqual([]);
    expect(validateScoreSets([{ teamOne: -1, teamTwo: 4 }])).toContain("Set scores must be non-negative integers.");
    expect(validateScoreSets([{ teamOne: 7, teamTwo: 6, tiebreakTeamOne: 7 }])).toContain("Tiebreak scores must be provided together.");
    expect(validateScoreSets(Array.from({ length: 6 }, () => ({ teamOne: 1, teamTwo: 0 })))).toContain("A match cannot contain more than five sets.");
  });

  it("parses scalar scores only when they are non-negative integers", () => {
    expect(parseScalarScore(3)).toBe(3);
    expect(parseScalarScore("03")).toBe(3);
    expect(parseScalarScore(1.5)).toBeUndefined();
    expect(parseScalarScore("3x")).toBeUndefined();
    expect(parseScalarScore(-1)).toBeUndefined();
    expect(parseScalarScore(null)).toBeNull();
  });

  it("treats explicit null tiebreak fields as absent", () => {
    const sets = parseScoreSets(JSON.stringify([{ teamOne: 6, teamTwo: 4, tiebreakTeamOne: null, tiebreakTeamTwo: null }]))!;
    expect(formatSetScore(sets[0])).toBe("6-4");
    expect(matchScoreFromSets(sets)).toEqual({ teamOne: 1, teamTwo: 0 });
  });

  it("parses only valid score set payloads", () => {
    expect(parseScoreSets(JSON.stringify([{ teamOne: 6, teamTwo: 4 }]))).toEqual([{ teamOne: 6, teamTwo: 4 }]);
    expect(parseScoreSets("not-json")).toBeNull();
    expect(parseScoreSets(JSON.stringify([{ teamOne: -1, teamTwo: 4 }]))).toBeNull();
  });
});
