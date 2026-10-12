/**
 * Nightshift queue rules, pinned.
 */
import { describe, expect, it } from "vitest";
import {
  branchForIssue,
  branchPrefixForIssue,
  hasOpenPr,
  isWorkable,
  planOrder,
  priorityOf,
  type IssueFacts,
  type OpenPrHead,
} from "../../scripts/nightshift/plan";

function issue(overrides: Partial<IssueFacts> = {}): IssueFacts {
  return {
    number: 1,
    title: "Add a thing",
    createdAt: "2026-01-01T00:00:00Z",
    labels: ["ready-for-agent"],
    ...overrides,
  };
}

describe("priority", () => {
  it("maps priority labels to numbers, defaulting to lowest", () => {
    expect(priorityOf(["dex:priority-1"])).toBe(1);
    expect(priorityOf(["dex:priority-3"])).toBe(3);
    expect(priorityOf([])).toBe(99);
  });
});

describe("workability", () => {
  it("accepts an offered, unblocked Issue with no open PR", () => {
    expect(isWorkable(issue(), [])).toBe(true);
  });

  it("rejects an Issue that was never offered", () => {
    expect(isWorkable(issue({ labels: [] }), [])).toBe(false);
  });

  it.each(["factory:blocked", "factory:explored"])("rejects a %s Issue", (label) => {
    expect(isWorkable(issue({ labels: ["ready-for-agent", label] }), [])).toBe(false);
  });

  it("rejects an Issue that already has an open Change", () => {
    const heads: OpenPrHead[] = [{ headRefName: "factory/1-add-a-thing" }];
    expect(isWorkable(issue({ number: 1 }), heads)).toBe(false);
  });

  it("does not confuse issue 1 with issue 12", () => {
    const heads: OpenPrHead[] = [{ headRefName: "factory/12-add-a-thing" }];
    expect(hasOpenPr(1, heads)).toBe(false);
    expect(hasOpenPr(12, heads)).toBe(true);
  });
});

describe("order", () => {
  it("orders by priority, then oldest (lowest number) first", () => {
    const issues = [
      issue({ number: 10, labels: ["ready-for-agent", "dex:priority-2"] }),
      issue({ number: 3, labels: ["ready-for-agent"] }),
      issue({ number: 5, labels: ["ready-for-agent", "dex:priority-1"] }),
      issue({ number: 7, labels: ["ready-for-agent", "dex:priority-1"] }),
    ];
    expect(planOrder(issues, [])).toEqual([5, 7, 10, 3]);
  });

  it("drops ineligible Issues from the order", () => {
    const issues = [
      issue({ number: 1 }),
      issue({ number: 2, labels: ["factory:blocked", "ready-for-agent"] }),
      issue({ number: 3, labels: ["ready-for-agent"] }),
    ];
    expect(planOrder(issues, [])).toEqual([1, 3]);
  });
});

describe("branch naming", () => {
  it("builds factory/<n>-<slug>", () => {
    expect(branchPrefixForIssue(12)).toBe("factory/12-");
    expect(branchForIssue(issue({ number: 12, title: "Add Thing!" }))).toBe("factory/12-add-thing");
  });

  it("falls back to a slug when the title has no usable characters", () => {
    expect(branchForIssue(issue({ number: 4, title: "???" }))).toBe("factory/4-work");
  });

  it("caps the slug length", () => {
    const long = branchForIssue(issue({ number: 9, title: "a".repeat(200) }));
    expect(long.length).toBeLessThanOrEqual("factory/9-".length + 40);
  });
});
