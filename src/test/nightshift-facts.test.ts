/**
 * Raw GitHub JSON → MergeFacts, pinned. Fails closed.
 */
import { describe, expect, it } from "vitest";
import { approvalsOf, buildMergeFacts, checksShaOf, type FactInput } from "../../scripts/nightshift/facts";

const SHA = "a".repeat(40);

function input(overrides: Partial<FactInput> = {}): FactInput {
  return {
    pr: {
      number: 5,
      author: "convocados-factory[bot]",
      baseRefName: "main",
      headRefName: "factory/5-add-thing",
      isDraft: false,
      mergeable: "MERGEABLE",
      labels: ["factory:review"],
      headRefOid: SHA,
      additions: 8,
      deletions: 2,
      changedFiles: 2,
    },
    checks: [
      { name: "CI", conclusion: "success", head_sha: SHA },
      { name: "Lint", conclusion: "success", head_sha: SHA },
    ],
    files: [{ path: "src/a.ts" }, { path: "src/test/a.test.ts" }],
    reviews: [{ author: "convocados-reviewer[bot]", state: "APPROVED" }],
    reviewThreadsUnresolved: 0,
    commitsBehindBase: 0,
    coverage: { delta: 0.1, thresholdsLowered: false },
    mutation: { delta: 0 },
    ...overrides,
  };
}

describe("approvalsOf", () => {
  it("keeps only the latest state per author", () => {
    const reviews = [
      { author: "a", state: "CHANGES_REQUESTED" },
      { author: "a", state: "APPROVED" },
      { author: "b", state: "COMMENTED" },
    ];
    expect(approvalsOf(reviews)).toEqual(["a"]);
  });

  it("ignores reviews with no author", () => {
    expect(approvalsOf([{ author: null, state: "APPROVED" }])).toEqual([]);
  });
});

describe("checksShaOf", () => {
  it("returns the shared SHA when checks agree", () => {
    expect(checksShaOf([{ name: "CI", conclusion: "success", head_sha: SHA }])).toBe(SHA);
  });

  it("returns empty when checks span more than one head", () => {
    expect(
      checksShaOf([
        { name: "CI", conclusion: "success", head_sha: SHA },
        { name: "Lint", conclusion: "success", head_sha: "b".repeat(40) },
      ]),
    ).toBe("");
  });
});

describe("buildMergeFacts", () => {
  it("sums additions and deletions into changed lines", () => {
    expect(buildMergeFacts(input()).changedLines).toBe(10);
  });

  it("keeps the file paths as touched paths", () => {
    expect(buildMergeFacts(input()).touchedPaths).toEqual(["src/a.ts", "src/test/a.test.ts"]);
  });

  it("passes coverage and mutation through", () => {
    const facts = buildMergeFacts(input({ coverage: { delta: -0.2, thresholdsLowered: true } }));
    expect(facts.coverageDelta).toBe(-0.2);
    expect(facts.coverageThresholdsLowered).toBe(true);
  });

  it("fails closed on no author", () => {
    const facts = buildMergeFacts(input({ pr: { ...input().pr, author: null } }));
    expect(facts.author).toBe("unknown");
  });

  it("produces facts the decision accepts when everything is green", () => {
    const facts = buildMergeFacts(input());
    // Sanity: the fixture is a mergeable shape (the decision is tested elsewhere).
    expect(facts.headSha).toBe(facts.checksSha);
    expect(facts.approvals).toEqual(["convocados-reviewer[bot]"]);
  });
});
