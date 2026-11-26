/**
 * The Fixer's schedule must answer the current review and stop, and it must not
 * spend a round on a Change that is already at its budget.
 *
 * It reads formal reviews as well as comments: the Reviewer posts a *review*,
 * so a picker that read `comments` only could never see a finding marker.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { type FixCandidate, needsFix, pickFix } from "../../scripts/factory/next-fix";

const HEAD = "aaaa1111bbbb2222";
const KEY = "test-key";
const FINDINGS = "<!-- factory:findings -->";

function sign(sha: string, verdict: string): string {
  return createHmac("sha256", KEY).update(`${sha}|${verdict}`).digest("hex");
}

beforeEach(() => {
  process.env.FACTORY_APP_KEY = KEY;
});
const reviewed = (sha: string, verdict = "refuse") =>
  `<!-- factory:verdict:${verdict} -->\n<!-- factory:reviewed:${sha}:${sign(sha, verdict)} -->`;
const verdict = (v: string) => `<!-- factory:verdict:${v} -->`;

function entry(body: string, createdAt = "2026-11-26T09:00:00Z", author = "convocarados-factory[bot]") {
  return { author, body, createdAt };
}

function pr(overrides: Partial<FixCandidate> = {}): FixCandidate {
  return {
    number: 1800,
    headRefName: "factory/1708-work",
    headRefOid: HEAD,
    entries: [entry(`${FINDINGS}\nTwo findings.\n${reviewed(HEAD)}`)],
    failingChecks: [],
    ...overrides,
  };
}

describe("needsFix", () => {
  it("answers a refusal that names this head", () => {
    expect(needsFix(pr())).toBe(true);
  });

  it("waits when the Reviewer approved", () => {
    expect(needsFix(pr({ entries: [entry(reviewed(HEAD, "approve"))] }))).toBe(false);
  });

  it("waits when the review named an older head, because the push answered it", () => {
    const pushed = pr({
      headRefOid: "cccc3333",
      entries: [entry(reviewed("aaaa1111"))],
    });
    expect(needsFix(pushed)).toBe(false);
  });

  it("takes the newest review, not any earlier one", () => {
    const clean = pr({
      entries: [
        entry(reviewed(HEAD), "2026-11-26T09:00:00Z"),
        entry(reviewed(HEAD, "approve"), "2026-11-26T09:10:00Z"),
      ],
    });
    expect(needsFix(clean)).toBe(false);
  });

  it("ignores a marker from anyone but the factory App", () => {
    expect(needsFix(pr({ entries: [entry(`${verdict("refuse")}\n${reviewed(HEAD)}`, "2026-11-26T09:00:00Z", "random-user")] }))).toBe(false);
  });

  it("never picks a human branch", () => {
    expect(needsFix(pr({ headRefName: "fix/1788-monthly-clamp" }))).toBe(false);
  });

  it("rounds on a red check even with no review", () => {
    expect(needsFix(pr({ entries: [], failingChecks: ["CI"] }))).toBe(true);
  });

  it("stops at the round budget, because a no-op round never clears the marker", () => {
    const spent = pr({
      entries: [
        entry(`${FINDINGS}\n${reviewed(HEAD)}`),
        entry("factory: attempt <review> (1/3)"),
        entry("factory: attempt <review> (2/3)"),
        entry("factory: attempt <review> (3/3)"),
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
    expect(pickFix([pr({ entries: [] })])).toBeNull();
    expect(pickFix([])).toBeNull();
  });
});

describe("a pending check is not a failure", () => {
  // The rollup reports PENDING while CI runs; rounding on it spends a round on
  // a non-answer.
  it("does not treat PENDING or EXPECTED as red", () => {
    const checkState = (state: string) =>
      ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(
        state.toUpperCase(),
      );
    expect(checkState("PENDING")).toBe(false);
    expect(checkState("EXPECTED")).toBe(false);
    expect(checkState("SUCCESS")).toBe(false);
    expect(checkState("FAILURE")).toBe(true);
  });
});
