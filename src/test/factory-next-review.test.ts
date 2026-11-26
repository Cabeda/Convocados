/**
 * A scheduled review must not re-read the same commit twice, and must re-read a
 * Change the moment it moves. Both rules live here so a wrong predicate cannot
 * ship green inside a workflow expression.
 *
 * It counts formal reviews, not only comments: the Reviewer posts a review, and
 * a picker that read `comments` only would re-review the same head forever.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { type ReviewCandidate, needsReview, pickReview } from "../../scripts/factory/next-review";

const HEAD = "aaaa1111bbbb2222";
const KEY = "test-key";

function sign(sha: string, verdict: string): string {
  return createHmac("sha256", KEY).update(`${sha}|${verdict}`).digest("hex");
}

beforeEach(() => {
  process.env.FACTORY_APP_KEY = KEY;
});

function entry(body: string, createdAt = "2026-11-26T09:00:00Z") {
  return { author: "convocarados-factory[bot]", body, createdAt };
}

function pr(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    number: 1800,
    headRefName: "factory/1708-work",
    headRefOid: HEAD,
    entries: [],
    ...overrides,
  };
}

const reviewed = (sha: string) =>
  `<!-- factory:verdict:approve -->\n<!-- factory:reviewed:${sha}:${sign(sha, "approve")} -->`;

describe("needsReview", () => {
  it("is true for a Change nobody has read", () => {
    expect(needsReview(pr())).toBe(true);
  });

  it("is false once a review names this exact head", () => {
    expect(needsReview(pr({ entries: [entry(reviewed(HEAD))] }))).toBe(false);
  });

  it("is true again after a push, because the review named the old head", () => {
    expect(needsReview(pr({ entries: [entry(reviewed("9999ffff"))] }))).toBe(true);
  });

  it("ignores a marker from anyone but the factory App", () => {
    // A stranger could otherwise suppress review by posting the marker.
    const forged = { author: "random-user", body: reviewed(HEAD), createdAt: "2026-11-26T09:00:00Z" };
    expect(needsReview(pr({ entries: [forged] }))).toBe(true);
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
    expect(pickReview([pr({ entries: [entry(reviewed(HEAD))] })])).toBeNull();
  });

  it("returns nothing when there is nothing open", () => {
    expect(pickReview([])).toBeNull();
  });
});
