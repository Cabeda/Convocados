import { describe, expect, it } from "vitest";
import {
  OUTCOMES,
  bestSix,
  contributionFor,
  crewMapFromLineup,
  liveContribution,
  liveCrewRoundScore,
  projectStakes,
  roundPoints,
  type StakesInput,
  type StakesPlayerInput,
} from "~/lib/stakesPreview";

function player(overrides: Partial<StakesPlayerInput> & { name: string }): StakesPlayerInput {
  return {
    skill: 1000,
    hidden: 0,
    display: 0,
    gamesThisSeason: 5,
    seeded: true,
    provisional: false,
    crewId: null,
    crewName: null,
    ...overrides,
  };
}

function input(overrides: Partial<StakesInput> = {}): StakesInput {
  return {
    teamOne: { players: [] },
    teamTwo: { players: [] },
    players: [],
    crews: [],
    edges: [0, 75, 102, 107, 118, 213],
    provisionalWindow: 3,
    ...overrides,
  };
}

describe("stakesPreview — scoring helpers", () => {
  it("maps a side's result to Season Contribution points", () => {
    expect(contributionFor("teamOne", "teamOne")).toBe(3);
    expect(contributionFor("teamOne", "draw")).toBe(1);
    expect(contributionFor("teamOne", "teamTwo")).toBe(0);
    expect(contributionFor("teamTwo", "teamOne")).toBe(0);
    expect(contributionFor("teamTwo", "teamTwo")).toBe(3);
  });

  it("rounds Crew points half-up to whole numbers", () => {
    expect(roundPoints(1.5)).toBe(2);
    expect(roundPoints(1.4)).toBe(1);
    expect(roundPoints(2.5)).toBe(3);
    expect(roundPoints(2.4)).toBe(2);
    expect(roundPoints(0)).toBe(0);
  });

  it("sums the best six scores", () => {
    expect(bestSix([3, 3, 3, 3, 3, 3, 0, 0])).toBe(18);
    expect(bestSix([1, 2, 3])).toBe(6);
    expect(bestSix([])).toBe(0);
  });

  it("maps Crews per participant and omits non-participants and free agents", () => {
    const map = crewMapFromLineup([
      { name: "Ana", side: "teamOne", crewId: "c1", crewName: "Sharks", participant: true },
      { name: "Bia", side: "teamTwo", crewId: null, crewName: null, participant: true },
      { name: "Guest", side: "teamOne", crewId: null, crewName: null, participant: false },
    ]);
    expect(map.Ana).toEqual({ crewId: "c1", crewName: "Sharks" });
    expect(map.Bia).toBeNull();
    expect("Guest" in map).toBe(false);
  });

  it("derives live contributions and Crew round scores from the current sides", () => {
    const points = liveContribution(["Ana"], ["Bia"], "teamOne");
    expect(points).toEqual({ Ana: 3, Bia: 0 });
    const roundScore = liveCrewRoundScore(
      [{ name: "Ana", side: "teamOne" }, { name: "Bia", side: "teamTwo" }],
      { Ana: { crewId: "c1", crewName: "Sharks" }, Bia: { crewId: "c1", crewName: "Sharks" } },
      points,
    );
    expect(roundScore).toEqual({ c1: 1.5 });
  });
});

describe("stakesPreview — scenarios", () => {
  it("returns the three side-result scenarios in order", () => {
    const scenarios = projectStakes(input());
    expect(scenarios.map((s) => s.outcome)).toEqual(OUTCOMES);
  });

  it("projects each player's contribution from their own side's result", () => {
    const scenarios = projectStakes(
      input({
        teamOne: { players: ["A"] },
        teamTwo: { players: ["B"] },
        players: [player({ name: "A" }), player({ name: "B" })],
      }),
    );
    const oneWins = scenarios.find((s) => s.outcome === "teamOne")!;
    const draw = scenarios.find((s) => s.outcome === "draw")!;
    expect(oneWins.players.find((p) => p.name === "A")!.contribution).toBe(3);
    expect(oneWins.players.find((p) => p.name === "B")!.contribution).toBe(0);
    expect(draw.players.find((p) => p.name === "A")!.contribution).toBe(1);
    expect(draw.players.find((p) => p.name === "B")!.contribution).toBe(1);
  });

  it("derives a Crew's round score as the mean of its lineup members, split sides included", () => {
    const scenarios = projectStakes(
      input({
        teamOne: { players: ["A"] },
        teamTwo: { players: ["B"] },
        players: [
          player({ name: "A", crewId: "c1", crewName: "Sharks" }),
          player({ name: "B", crewId: "c1", crewName: "Sharks" }),
        ],
        crews: [{ crewId: "c1", name: "Sharks", scores: [] }],
      }),
    );
    const oneWins = scenarios.find((s) => s.outcome === "teamOne")!;
    const crew = oneWins.crews.find((c) => c.crewId === "c1")!;
    // 3 (win) + 0 (loss) → mean 1.5 → rounded half-up to 2.
    expect(crew.roundScore).toBe(2);
    expect(crew.membersInLineup).toBe(2);
  });

  it("ignores lineup players who are not Season participants", () => {
    const scenarios = projectStakes(
      input({
        teamOne: { players: ["A", "Guest"] },
        players: [player({ name: "A" })],
      }),
    );
    expect(scenarios[0].players.map((p) => p.name)).toEqual(["A"]);
  });
});

describe("stakesPreview — Rank movement", () => {
  it("pays a win more Rank Points than a draw, and a draw more than a loss", () => {
    const scenarios = projectStakes(
      input({
        teamOne: { players: ["A"] },
        teamTwo: { players: ["B"] },
        players: [player({ name: "A" }), player({ name: "B" })],
      }),
    );
    const a = (o: string) =>
      scenarios.find((s) => s.outcome === o)!.players.find((p) => p.name === "A")!.rpDelta;
    expect(a("teamOne")).toBeGreaterThan(a("draw"));
    expect(a("draw")).toBeGreaterThan(a("teamTwo"));
  });

  it("moves a winning underdog up the ladder and reports how many places were passed", () => {
    const scenarios = projectStakes(
      input({
        teamOne: { players: ["under"] },
        teamTwo: { players: ["lead"] },
        players: [
          player({ name: "lead", skill: 1200, hidden: 20, display: 20 }),
          player({ name: "mid", skill: 1000, hidden: 10, display: 10 }),
          player({ name: "under", skill: 800, hidden: 0, display: 0 }),
        ],
      }),
    );
    const p = scenarios
      .find((s) => s.outcome === "teamOne")!
      .players.find((x) => x.name === "under")!;
    expect(p.positionBefore).toBe(3);
    expect(p.positionAfter).toBe(1);
    expect(p.passed).toBe(2);
    expect(p.rankAfter).toBeGreaterThan(p.rankBefore);
  });

  it("does not move a player who is not on either lineup", () => {
    const scenarios = projectStakes(
      input({
        teamOne: { players: ["A"] },
        players: [player({ name: "A", hidden: 30, display: 30 }), player({ name: "benched", hidden: 10, display: 10 })],
      }),
    );
    const b = scenarios[0];
    expect(b.players.some((p) => p.name === "benched")).toBe(false);
    // The benched player keeps their place in the ladder.
    expect(b.crews.length).toBe(0);
  });
});

describe("stakesPreview — Crew standings movement", () => {
  it("shows a Crew passing another when the projected round score lifts its best six", () => {
    const scenarios = projectStakes(
      input({
        teamOne: { players: ["b1"] },
        players: [
          player({ name: "b1", crewId: "c2", crewName: "Second" }),
        ],
        crews: [
          { crewId: "c1", name: "First", scores: [3] },
          { crewId: "c2", name: "Second", scores: [3] },
        ],
      }),
    );
    const oneWins = scenarios.find((s) => s.outcome === "teamOne")!;
    const second = oneWins.crews.find((c) => c.crewId === "c2")!;
    const first = oneWins.crews.find((c) => c.crewId === "c1")!;
    // Second's member wins (3), First's member is not playing (0) → 6 vs 3.
    expect(second.roundScore).toBe(3);
    expect(second.positionBefore).toBe(2);
    expect(second.positionAfter).toBe(1);
    expect(second.passed).toBe(1);
    expect(first.passed).toBe(-1);
  });
});
