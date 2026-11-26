/**
 * The Fixer's schedule must answer the current review and stop, and it must not
 * spend a round on a Change that is already at its budget.
 */
import { describe, expect, it } from "vitest";
import { type FixCandidate, needsFix, pickFix } from "../../scripts/factory/next-fix";

const FINDINGS = "<!-- factory:findings -->";
const reviewed = (sha: string) => `<!-- factory:reviewed:${sha} -->`;

function pr(overrides: Partial<FixCandidate> = {}): FixCandidate {
  return {
    number: 1800,
    headRefName: "factory/1708-work",
    headRefOid: "aaaa1111",
    comments: [{ body: `${reviewed("aaaa1111")}\n${FINDINGS}\nTwo findings.` }],
    ...overrides,
  };
}

describe("needsFix", () => {
  it("answers a review that names this head and carries findings", () => {
    expect(needsFix(pr())).toBe(true);
  });

  it("waits when the review found nothing", () => {
    expect(needsFix(pr({ comments: [{ body: reviewed("aaaa1111") }] }))).toBe(false);
  });

  it("waits when the review named an older head, because the push answered it", () => {
    const pushed = pr({
      headRefOid: "bbbb2222",
      comments: [{ body: `${reviewed("aaaa1111")}\n${FINDINGS}` }],
    });
    expect(needsFix(pushed)).toBe(false);
  });

  it("takes the newest review, not any earlier one", () => {
    const clean = pr({
      comments: [
        { body: `${reviewed("aaaa1111")}\n${FINDINGS}` },
        { body: reviewed("bbbb2222") },
      ],
      headRefOid: "bbbb2222",
    });
    expect(needsFix(clean)).toBe(false);
  });

  it("never picks a human branch", () => {
    expect(needsFix(pr({ headRefName: "fix/1788-monthly-clamp" }))).toBe(false);
  });

  it("stops at the round budget, because a no-op round never clears the marker", () => {
    const spent = pr({
      comments: [
        { body: `${reviewed("aaaa1111")}\n${FINDINGS}` },
        { body: "factory: attempt <review> (1/3)" },
        { body: "factory: attempt <review> (2/3)" },
        { body: "factory: attempt <review> (3/3)" },
      ],
    });
    expect(needsFix(spent)).toBe(false);
  });
});

describe("pickFix", () => {
  it("takes the oldest Change that is waiting", () => {
    const a = pr({ number: 1801 });
    const b = pr({ number: 1802, headRefName: "factory/1709-work" });
    expect(pickFix([b, a])?.number).toBe(1801);
  });

  it("returns nothing when nothing is waiting", () => {
    expect(pickFix([pr({ comments: [] })])).toBeNull();
    expect(pickFix([])).toBeNull();
  });
});
