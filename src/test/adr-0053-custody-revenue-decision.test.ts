/**
 * GH-1081 / dex y5l1k2q3 — the custodial-wallet spike ends as decided-no.
 *
 * The decision doc is the spike's entire output: it records that Convocados
 * stays non-custodial and names the revenue levers that replace custody. The
 * guards below keep that record from drifting into "we hold funds now", and
 * keep the spike's external questions (Portuguese licensing cost, Stripe MB Way
 * fees) from being presented as researched answers nobody researched.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "../..");
const DOC = "docs/adr/0053-no-custodial-wallet-revenue-path.md";
const read = () =>
  existsSync(resolve(root, DOC)) ? readFileSync(resolve(root, DOC), "utf8") : "";

describe("ADR 0053 — no custodial wallet (GH-1081)", () => {
  it("exists", () => {
    expect(existsSync(resolve(root, DOC))).toBe(true);
  });

  it("records the decision as decided-no, with its Issue and decision date", () => {
    const doc = read();
    expect(doc).toMatch(/\*\*Status:\*\*\s*accepted/i);
    expect(doc).toMatch(/decided-no/i);
    expect(doc).toMatch(/1081/);
    expect(doc).toMatch(/2026-10-19/);
  });

  it("keeps Convocados non-custodial and points back at ADR 0038", () => {
    const doc = read();
    expect(doc).toMatch(/non-custodial/i);
    expect(doc).toMatch(/ADR 0038/);
    expect(doc).toMatch(/never holds funds/i);
    expect(doc).not.toMatch(/Convocados (holds|will hold) funds/i);
  });

  it("names both revenue levers that replace custody", () => {
    const doc = read();
    expect(doc).toMatch(/application fee/i);
    expect(doc).toMatch(/platformFeeCents|fees_collector/i);
    expect(doc).toMatch(/subscription/i);
  });

  it("keeps the spike's external questions open instead of answering them", () => {
    const doc = read();
    expect(doc).toMatch(/open questions/i);
    expect(doc).toMatch(/not researched|unverified/i);
  });

  it("never presents the fee plumbing as already built when the repo has none", () => {
    const doc = read();
    const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
    const schemaHasFee = /model EventCost[^}]*\bplatformFeeCents\b/s.test(schema);
    if (!schemaHasFee) {
      expect(doc).not.toMatch(/plumbing is model-ready/i);
      expect(doc).not.toMatch(/model already carries/i);
    }
  });
});
