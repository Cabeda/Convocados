/**
 * The auto-merge decision, pinned.
 *
 * These are the conditions under which a machine merges a PR into a repo where
 * merging deploys. Each block is a way the answer went wrong before.
 */
import { describe, expect, it } from "vitest";
import {
  decideAutomerge,
  explain,
  REQUIRED_CHECKS,
  type Check,
  type PullRequestFacts,
} from "../../scripts/factory/automerge-eligibility";

const GREEN: Check[] = [
  { name: "CI", conclusion: "success" },
  { name: "Analyze (javascript-typescript)", conclusion: "success" },
  { name: "Typecheck", conclusion: "success" },
  { name: "Lint", conclusion: "success" },
  { name: "Dependency Audit", conclusion: "success" },
  { name: "Build", conclusion: "success" },
];

function pr(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    number: 1,
    author: "dependabot[bot]",
    baseRefName: "main",
    headRefName: "dependabot/npm_and_yarn/thing-1.0.0",
    isDraft: false,
    mergeable: "MERGEABLE",
    commitsBehindBase: 0,
    labels: [],
    checks: GREEN,
    ...overrides,
  };
}

describe("a fully green dependency bump is eligible", () => {
  it("accepts it", () => {
    const verdict = decideAutomerge(pr());
    expect(verdict.reasons).toEqual([]);
    expect(verdict.eligible).toBe(true);
  });
});

describe("a human's Change is never auto-merged", () => {
  it("rejects a non-dependabot author", () => {
    const verdict = decideAutomerge(pr({ author: "Cabeda" }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/always gets a human/);
  });

  it("rejects the factory's own bot author too", () => {
    // The Factory pushing its own Change and then merging it is the exact
    // self-approval loop branch protection exists to prevent.
    const verdict = decideAutomerge(pr({ author: "convocados-factory[bot]" }));
    expect(verdict.eligible).toBe(false);
  });
});

describe("a missing gate is not a passing gate", () => {
  it("rejects when a required check never ran", () => {
    const checks = GREEN.filter((c) => c.name !== "Dependency Audit");
    const verdict = decideAutomerge(pr({ checks }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/Dependency Audit.*never ran/);
  });

  it("rejects when a required check is still pending", () => {
    const checks = GREEN.map((c) => (c.name === "Lint" ? { name: c.name, conclusion: null } : c));
    const verdict = decideAutomerge(pr({ checks }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/Lint.*has not completed/);
  });

  it("rejects on a non-success conclusion, including neutral", () => {
    for (const conclusion of ["failure", "cancelled", "timed_out", "neutral", "action_required", "skipped"]) {
      const checks = GREEN.map((c) => (c.name === "Build" ? { name: c.name, conclusion } : c));
      const verdict = decideAutomerge(pr({ checks }));
      expect(verdict.eligible, conclusion).toBe(false);
      expect(verdict.reasons.join(), conclusion).toMatch(/Build/);
    }
  });

  it("names every required check explicitly, so a rename cannot drop a gate", () => {
    // The two contexts the `main` rulesets genuinely require.
    expect(REQUIRED_CHECKS).toContain("CI");
    expect(REQUIRED_CHECKS).toContain("Analyze (javascript-typescript)");
    // The individual gates `CI` aggregates, named so a red member cannot hide
    // behind a green aggregate.
    expect(REQUIRED_CHECKS).toContain("Typecheck");
    expect(REQUIRED_CHECKS).toContain("Lint");
    expect(REQUIRED_CHECKS).toContain("Dependency Audit");
    expect(REQUIRED_CHECKS).toContain("Build");
  });

  it("does not require Coverage Gate, because it is skipped on dependency-only diffs", () => {
    // A dependency bump that changes no source cannot move coverage, so the
    // Coverage Gate job legitimately reports `skipped`. Requiring it would make
    // every Dependabot PR permanently ineligible and the policy dead on
    // arrival. Deliberately excluded, and pinned here so nobody adds it back
    // without meeting this problem.
    expect([...REQUIRED_CHECKS]).not.toContain("Coverage Gate");
  });
});

describe("a stale branch is not eligible (regression: #1256)", () => {
  it("rejects a PR that is behind base", () => {
    // #1256's lockfile predated the sharp override. Its CI was green because
    // the branch did not have the override; merging reverted the pin and put
    // Dependency Audit back to red on main.
    const verdict = decideAutomerge(pr({ commitsBehindBase: 12 }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/12 commit\(s\) behind base/);
  });

  it("rejects a PR whose mergeability GitHub has not computed", () => {
    const verdict = decideAutomerge(pr({ mergeable: "UNKNOWN" }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/UNKNOWN/);
  });

  it("rejects a conflicting PR", () => {
    expect(decideAutomerge(pr({ mergeable: "CONFLICTING" })).eligible).toBe(false);
  });
});

describe("anything a human is already handling is left alone", () => {
  it("rejects a draft", () => {
    expect(decideAutomerge(pr({ isDraft: true })).eligible).toBe(false);
  });

  it("rejects a Change labelled factory:blocked", () => {
    const verdict = decideAutomerge(pr({ labels: ["factory:blocked"] }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/factory:blocked/);
  });

  it("tolerates unrelated labels", () => {
    expect(decideAutomerge(pr({ labels: ["dependencies", "factory:review"] })).eligible).toBe(true);
  });

  it("rejects a non-main base", () => {
    expect(decideAutomerge(pr({ baseRefName: "develop" })).eligible).toBe(false);
  });
});

describe("every failure is reported, not just the first", () => {
  it("lists all reasons", () => {
    const verdict = decideAutomerge(
      pr({ author: "Cabeda", isDraft: true, commitsBehindBase: 3, mergeable: "CONFLICTING" }),
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(4);
  });
});

describe("explain() is usable as an audit line", () => {
  it("names the PR and the verdict", () => {
    expect(explain(pr({ number: 42 }), decideAutomerge(pr({ number: 42 })))).toBe(
      "#42 (dependabot/npm_and_yarn/thing-1.0.0) — eligible",
    );
  });

  it("carries the reasons when not eligible", () => {
    const p = pr({ number: 7, commitsBehindBase: 1 });
    expect(explain(p, decideAutomerge(p))).toMatch(/not eligible: .*behind base/);
  });
});