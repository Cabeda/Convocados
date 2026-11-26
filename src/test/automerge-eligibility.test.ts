/**
 * The auto-merge decision, pinned.
 *
 * These are the conditions under which a machine merges a PR into a repo where
 * merging deploys. Each block is a way the answer went wrong before.
 */
import { describe, expect, it } from "vitest";
import {
  BEHIND_BASE,
  decideAutomerge,
  decideFactoryMerge,
  explain,
  type FactoryFacts,
  isTwoWayDoor,
  latestReview,
  REQUIRED_CHECKS,
  type Check,
  type PullRequestFacts,
  type ReviewEntry,
} from "../../scripts/factory/automerge-eligibility";

const GREEN: Check[] = [
  { name: "CI", conclusion: "success" },
  { name: "Analyze (javascript-typescript)", conclusion: "success" },
  { name: "Typecheck", conclusion: "success" },
  { name: "Lint", conclusion: "success" },
  { name: "Dependency Audit", conclusion: "success" },
  { name: "Build", conclusion: "success" },
  { name: "PR Links Issue", conclusion: "success" },
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
// ── Factory Changes and the two-way door ────────────────────────────────────

const HEAD = "70d5e19ac8099eb60ba23386c24ca6aeb43a0617";

function review(overrides: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    author: "convocarados-factory[bot]",
    body: `No findings.\n<!-- factory:verdict:approve -->\n<!-- factory:reviewed:${HEAD} -->`,
    createdAt: "2026-11-26T09:00:00Z",
    ...overrides,
  };
}

function factoryPr(overrides: Partial<FactoryFacts> = {}): FactoryFacts {
  return {
    number: 1800,
    author: "app/convocarados-factory",
    baseRefName: "main",
    headRefName: "factory/1708-work",
    headRefOid: HEAD,
    isDraft: false,
    mergeable: "MERGEABLE",
    commitsBehindBase: 0,
    labels: [],
    checks: GREEN,
    files: ["src/lib/roster.ts", "src/test/roster.test.ts"],
    reviews: [review()],
    ...overrides,
  };
}

describe("a two-way door", () => {
  it("is a change to ordinary application code", () => {
    expect(isTwoWayDoor(["src/lib/roster.ts", "src/test/roster.test.ts"]).eligible).toBe(true);
  });

  it.each([
    "prisma/migrations/20261126000000_add/migration.sql",
    "prisma/schema.prisma",
    "src/pages/api/auth/register.ts",
    "src/lib/auth.server.ts",
    // The first list called these two-way; the Reviewer named them by file.
    "src/lib/googleToken.server.ts",
    "src/lib/calendarToken.server.ts",
    "src/lib/cronAuth.server.ts",
    "src/lib/scheduler.server.ts",
    "scripts/backfill-scheduled-jobs.ts",
    "litestream.yml",
    // A Change that weakens the gate, or the rules that judge it.
    "scripts/factory/automerge-eligibility.ts",
    "scripts/factory/factory-merge-run.ts",
    ".opencode/agents/reviewer.md",
    ".github/workflows/factory-merge.yml",
    "AGENTS.md",
    "package.json",
    "fly.toml",
    "vitest.config.ts",
  ])("is not %s", (file) => {
    const door = isTwoWayDoor([file]);
    expect(door.eligible, file).toBe(false);
    expect(door.reasons[0]).toContain("one-way door");
  });
});

describe("the review a merge reads", () => {
  it("takes the newest review and its verdict", () => {
    expect(
      latestReview([
        review({ body: `<!-- factory:verdict:refuse -->\n<!-- factory:reviewed:${HEAD} -->` }),
        review({ body: `<!-- factory:verdict:approve -->\n<!-- factory:reviewed:${HEAD} -->`, createdAt: "2026-11-26T10:00:00Z" }),
      ]),
    ).toEqual({ head: HEAD, verdict: "approve" });
  });

  it("orders a comment after an older review by time, not by list", () => {
    // The bug: comments and reviews arrive in two lists, and concatenating them
    // read an older approval as the current word.
    expect(
      latestReview([
        review({ body: `<!-- factory:verdict:approve -->\n<!-- factory:reviewed:${HEAD} -->`, createdAt: "2026-11-26T09:00:00Z" }),
        review({ body: `<!-- factory:verdict:refuse -->\n<!-- factory:reviewed:${HEAD} -->`, createdAt: "2026-11-26T09:05:00Z" }),
      ])?.verdict,
    ).toBe("refuse");
  });

  it("takes the last marker in a body, so quoting refuse does not approve", () => {
    expect(
      latestReview([
        review({
          body: `I considered <!-- factory:verdict:approve --> and rejected it.\n<!-- factory:verdict:refuse -->\n<!-- factory:reviewed:${HEAD} -->`,
        }),
      ])?.verdict,
    ).toBe("refuse");
  });

  it("ignores a marker from anyone but the factory App", () => {
    // Any GitHub user could comment the markers; the gate merged on the text.
    expect(
      latestReview([review({ author: "random-user" })]),
    ).toBeNull();
    expect(latestReview([review({ author: "Cabeda" })])).toBeNull();
  });

  it("returns null when nothing reviewed this Change", () => {
    expect(latestReview([review({ body: "just a comment" })])).toBeNull();
  });
});

describe("decideFactoryMerge", () => {
  it("merges a green, approved, two-way factory Change", () => {
    expect(decideFactoryMerge(factoryPr())).toEqual({ eligible: true, reasons: [] });
  });

  it("accepts an approval that abbreviated the head", () => {
    const short = review({ body: `<!-- factory:verdict:approve -->\n<!-- factory:reviewed:${HEAD.slice(0, 7)} -->` });
    expect(decideFactoryMerge(factoryPr({ reviews: [short] })).eligible).toBe(true);
  });

  it("refuses a Change the Reviewer refused", () => {
    const verdict = decideFactoryMerge(
      factoryPr({ reviews: [review({ body: `<!-- factory:verdict:refuse -->\n<!-- factory:reviewed:${HEAD} -->` })] }),
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("refuse");
  });

  it("refuses a Change whose only approval named an older head", () => {
    const verdict = decideFactoryMerge(
      factoryPr({ reviews: [review({ body: `<!-- factory:verdict:approve -->\n<!-- factory:reviewed:9999ffff -->` })] }),
    );
    expect(verdict.reasons.join(" ")).toContain("not the current head");
  });

  it("refuses a Change nobody reviewed", () => {
    expect(decideFactoryMerge(factoryPr({ reviews: [] })).reasons.join(" ")).toContain(
      "no review has named its head",
    );
  });

  it("refuses a one-way door even when green and approved", () => {
    const verdict = decideFactoryMerge(factoryPr({ files: ["prisma/schema.prisma"] }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("one-way door");
  });

  it("refuses anything the human has parked", () => {
    expect(
      decideFactoryMerge(factoryPr({ labels: ["factory:blocked"] })).reasons.join(" "),
    ).toContain("factory:blocked");
  });

  it("refuses a human's Change", () => {
    expect(decideFactoryMerge(factoryPr({ author: "Cabeda" })).reasons.join(" ")).toContain(
      "not the factory App",
    );
  });

  it("requires PR Links Issue, which both rulesets do", () => {
    const checks = GREEN.filter((c) => c.name !== "PR Links Issue");
    const verdict = decideFactoryMerge(factoryPr({ checks }));
    expect(verdict.reasons.join(" ")).toContain("PR Links Issue");
  });

  it("names a stale base so the runner can update the branch", () => {
    const verdict = decideFactoryMerge(factoryPr({ commitsBehindBase: 2 }));
    expect(verdict.reasons.join(" ")).toContain(BEHIND_BASE);
  });
});
