/**
 * A scheduled review must not re-read the same commit twice, and must re-read a
 * Change the moment it moves. Both rules live here so a wrong predicate cannot
 * ship green inside a workflow expression.
 */
import { describe, expect, it } from "vitest";
import {
  type ReviewCandidate,
  needsReview,
  pickReview,
  reviewedMarker,
} from "../../scripts/factory/next-review";

function pr(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    number: 1800,
    headRefName: "factory/1708-work",
    headRefOid: "aaaa1111",
    comments: [],
    ...overrides,
  };
}

describe("needsReview", () => {
  it("is true for a Change nobody has read", () => {
    expect(needsReview(pr())).toBe(true);
  });

  it("is false once a review names this exact head", () => {
    expect(needsReview(pr({ comments: [{ body: reviewedMarker("aaaa1111") }] }))).toBe(false);
  });

  it("is true again after a push, because the review named the old head", () => {
    const pushed = pr({ headRefOid: "bbbb2222", comments: [{ body: reviewedMarker("aaaa1111") }] });
    expect(needsReview(pushed)).toBe(true);
  });
});

describe("pickReview", () => {
  it("takes the oldest unreviewed factory Change", () => {
    const older = pr({ number: 1801 });
    const newer = pr({ number: 1802, headRefName: "factory/1709-work" });
    expect(pickReview([newer, older])?.number).toBe(1801);
  });

  it("never picks a human branch", () => {
    expect(pickReview([pr({ headRefName: "fix/1788-monthly-clamp" })])).toBeNull();
  });

  it("skips a Change already reviewed at its head", () => {
    const read = pr({ comments: [{ body: reviewedMarker("aaaa1111") }] });
    expect(pickReview([read])).toBeNull();
  });

  it("returns nothing when there is nothing open", () => {
    expect(pickReview([])).toBeNull();
  });
});
