/**
 * The Nightshift merge decision, pinned.
 *
 * These are the conditions under which a local loop merges a PR into a repo
 * where merging deploys. Each block is a way the answer went wrong, or would.
 */
import { describe, expect, it } from "vitest";
import {
  decideMerge,
  explain,
  DEFAULT_POLICY,
  HARD_BLOCK_PATTERNS,
  REQUIRED_CHECKS,
  type Check,
  type MergeFacts,
} from "../../scripts/nightshift/merge-eligibility";

const GREEN: Check[] = [
  { name: "CI", conclusion: "success" },
  { name: "Analyze (javascript-typescript)", conclusion: "success" },
  { name: "Typecheck", conclusion: "success" },
  { name: "Lint", conclusion: "success" },
  { name: "Dependency Audit", conclusion: "success" },
  { name: "Build", conclusion: "success" },
  { name: "Coverage Gate", conclusion: "success" },
];

const SHA = "a".repeat(40);

function pr(overrides: Partial<MergeFacts> = {}): MergeFacts {
  return {
    number: 1,
    author: "convocados-factory[bot]",
    baseRefName: "main",
    headRefName: "factory/1-add-thing",
    isDraft: false,
    mergeable: "MERGEABLE",
    commitsBehindBase: 0,
    labels: ["factory:review"],
    checks: GREEN,
    headSha: SHA,
    checksSha: SHA,
    changedLines: 10,
    changedFiles: 2,
    reviewThreadsUnresolved: 0,
    approvals: ["convocados-reviewer[bot]"],
    coverageDelta: 0,
    mutationDelta: 0,
    coverageThresholdsLowered: false,
    touchedPaths: ["src/lib/thing.ts", "src/test/thing.test.ts"],
    ...overrides,
  };
}

describe("a fully green loop Change is eligible", () => {
  it("accepts it", () => {
    const verdict = decideMerge(pr());
    expect(verdict.reasons).toEqual([]);
    expect(verdict.eligible).toBe(true);
  });
});

describe("a human's Change is never auto-merged", () => {
  it("rejects a non-loop author", () => {
    const verdict = decideMerge(pr({ author: "Cabeda" }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/always gets a human/);
  });

  it("honours a widened policy only for the identities named", () => {
    const verdict = decideMerge(pr({ author: "someone-else[bot]" }), {
      ...DEFAULT_POLICY,
      allowedAuthors: ["someone-else[bot]"],
    });
    expect(verdict.eligible).toBe(true);
  });
});

describe("a missing gate is not a passing gate", () => {
  it("rejects when a required check never ran", () => {
    const checks = GREEN.filter((c) => c.name !== "Coverage Gate");
    const verdict = decideMerge(pr({ checks }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/Coverage Gate never ran/);
  });

  it("rejects when a required check is still pending", () => {
    const checks = GREEN.map((c) => (c.name === "Lint" ? { name: c.name, conclusion: null } : c));
    const verdict = decideMerge(pr({ checks }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/Lint has not completed/);
  });

  it("rejects a non-success conclusion, including skipped and neutral", () => {
    for (const conclusion of ["failure", "cancelled", "timed_out", "neutral", "action_required", "skipped"]) {
      const checks = GREEN.map((c) => (c.name === "Build" ? { name: c.name, conclusion } : c));
      const verdict = decideMerge(pr({ checks }));
      expect(verdict.eligible, conclusion).toBe(false);
      expect(verdict.reasons.join(), conclusion).toMatch(/Build/);
    }
  });

  it("names the coverage gate, unlike the Dependabot policy", () => {
    // Nightshift works source changes, so a skipped coverage run is a real gap.
    expect(REQUIRED_CHECKS).toContain("Coverage Gate");
  });
});

describe("a stale or moved head is not eligible", () => {
  it("rejects a PR behind base (regression: #1256)", () => {
    const verdict = decideMerge(pr({ commitsBehindBase: 12 }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/12 commit\(s\) behind base/);
  });

  it("rejects when the head SHA moved after CI settled", () => {
    const verdict = decideMerge(pr({ headSha: "b".repeat(40), checksSha: SHA }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/not the SHA CI ran on/);
  });

  it("rejects unknown or conflicting mergeability", () => {
    expect(decideMerge(pr({ mergeable: "UNKNOWN" })).eligible).toBe(false);
    expect(decideMerge(pr({ mergeable: "CONFLICTING" })).eligible).toBe(false);
  });
});

describe("a self-approved or objected Change is not eligible", () => {
  it("rejects with no independent approval", () => {
    const verdict = decideMerge(pr({ approvals: [] }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/independent required approver/);
  });

  it("rejects an approval from the author's own identity", () => {
    const verdict = decideMerge(pr({ approvals: ["convocados-factory[bot]"] }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/independent required approver/);
  });

  it("rejects an untrusted approver", () => {
    const verdict = decideMerge(pr({ approvals: ["random-user"] }));
    expect(verdict.eligible).toBe(false);
  });

  it("rejects while a review thread is open", () => {
    const verdict = decideMerge(pr({ reviewThreadsUnresolved: 1 }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/1 unresolved review thread/);
  });
});

describe("the coverage and mutation ratchets hold", () => {
  it("rejects a coverage drop", () => {
    const verdict = decideMerge(pr({ coverageDelta: -0.4 }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/coverage dropped by 0.40%/);
  });

  it("rejects a lowered coverage threshold even with positive delta", () => {
    const verdict = decideMerge(pr({ coverageDelta: 1, coverageThresholdsLowered: true }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/threshold was lowered/);
  });

  it("rejects a mutation score drop", () => {
    expect(decideMerge(pr({ mutationDelta: -2 })).eligible).toBe(false);
  });
});

describe("unrecoverable and constitution paths never auto-merge", () => {
  it("rejects a Prisma migration", () => {
    const verdict = decideMerge(pr({ touchedPaths: ["prisma/migrations/20260101_x/migration.sql"] }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join()).toMatch(/hard-block/);
  });

  it.each([
    ".github/workflows/ci.yml",
    ".github/CODEOWNERS",
    "AGENTS.md",
    "scripts/factory/gate.sh",
    "scripts/nightshift/merge.ts",
    "docs/factory/nightshift.md",
  ])("rejects %s", (path) => {
    expect(decideMerge(pr({ touchedPaths: [path] })).eligible).toBe(false);
  });

  it("tolerates ordinary source paths", () => {
    expect(decideMerge(pr({ touchedPaths: ["src/pages/api/foo.ts", "android-app/app/build.gradle.kts"] })).eligible).toBe(
      true,
    );
  });

  it("keeps the hard-block list non-empty", () => {
    expect(HARD_BLOCK_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe("size and queue state", () => {
  it("rejects an over-large diff", () => {
    expect(decideMerge(pr({ changedLines: 401 })).eligible).toBe(false);
    expect(decideMerge(pr({ changedFiles: 21 })).eligible).toBe(false);
  });

  it("rejects an unready or parked Change", () => {
    expect(decideMerge(pr({ labels: [] })).eligible).toBe(false);
    expect(decideMerge(pr({ labels: ["factory:review", "factory:blocked"] })).eligible).toBe(false);
  });

  it("rejects a draft", () => {
    expect(decideMerge(pr({ isDraft: true })).eligible).toBe(false);
  });

  it("rejects a non-main base", () => {
    expect(decideMerge(pr({ baseRefName: "develop" })).eligible).toBe(false);
  });
});

describe("every failure is reported, not just the first", () => {
  it("lists all reasons", () => {
    const verdict = decideMerge(
      pr({ author: "Cabeda", isDraft: true, commitsBehindBase: 3, mergeable: "CONFLICTING" }),
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(4);
  });
});

describe("explain() is usable as an audit line", () => {
  it("names the PR and the verdict", () => {
    const p = pr({ number: 42 });
    expect(explain(p, decideMerge(p))).toBe("#42 (factory/1-add-thing) — eligible");
  });

  it("carries the reasons when not eligible", () => {
    const p = pr({ number: 7, commitsBehindBase: 1 });
    expect(explain(p, decideMerge(p))).toMatch(/not eligible: .*behind base/);
  });
});
