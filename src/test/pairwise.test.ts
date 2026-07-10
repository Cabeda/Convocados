import { describe, it, expect } from "vitest";
import { computePairwiseDebts, type NetPosition } from "../lib/pairwise";

describe("computePairwiseDebts", () => {
  it("returns empty list when all positions are zero", () => {
    expect(computePairwiseDebts([])).toEqual([]);
    expect(
      computePairwiseDebts([
        { playerName: "A", netCents: 0 },
        { playerName: "B", netCents: 0 },
      ]),
    ).toEqual([]);
  });

  it("returns a single debt for a 2-person group (Pai owes José)", () => {
    const result = computePairwiseDebts([
      { playerName: "Pai", netCents: -257800 },
      { playerName: "José", netCents: 257800 },
    ]);
    expect(result).toEqual([
      { fromName: "Pai", toName: "José", amountCents: 257800 },
    ]);
  });

  it("minimises number of transactions in a 3-person group (greedy min-cash-flow)", () => {
    // A paid everything. A's net is -100, B's net is +60, C's net is +40.
    // Optimal: 2 transactions (A→B 60, A→C 40) — not 3.
    const result = computePairwiseDebts([
      { playerName: "A", netCents: -10000 },
      { playerName: "B", netCents: 6000 },
      { playerName: "C", netCents: 4000 },
    ]);
    const total = result.reduce((s, d) => s + d.amountCents, 0);
    expect(total).toBe(10000);
    // A is the sole debtor; B and C are creditors.
    expect(result.every((d) => d.fromName === "A")).toBe(true);
    expect(result.find((d) => d.toName === "B")?.amountCents).toBe(6000);
    expect(result.find((d) => d.toName === "C")?.amountCents).toBe(4000);
  });

  it("handles multiple debtors and creditors in a 4-person group", () => {
    // A: -80, B: -20, C: +50, D: +50
    // Greedy: pair largest debtor (A, -80) with largest creditor (C, +50) → A→C 50.
    //         A remaining -30, B -20, C 0, D +50.
    //         Pair A with D → A→D 30. B with D → B→D 20.
    //         Result: 3 transactions totalling 100.
    const result = computePairwiseDebts([
      { playerName: "A", netCents: -8000 },
      { playerName: "B", netCents: -2000 },
      { playerName: "C", netCents: 5000 },
      { playerName: "D", netCents: 5000 },
    ]);
    const total = result.reduce((s, d) => s + d.amountCents, 0);
    expect(total).toBe(10000);
    // At most 3 transactions (greedy on 4 players produces ≤ 3).
    expect(result.length).toBeLessThanOrEqual(3);
    // All transactions flow debtor → creditor.
    for (const d of result) {
      expect(d.amountCents).toBeGreaterThan(0);
      expect(d.fromName).not.toBe(d.toName);
    }
  });

  it("rounds sub-cent dust so every net position is cleared", () => {
    // Imbalanced sums due to rounding; result should still clear every position.
    const result = computePairwiseDebts([
      { playerName: "A", netCents: -3333 },
      { playerName: "B", netCents: 1000 },
      { playerName: "C", netCents: 2333 },
    ]);
    const totals = new Map<string, number>();
    for (const d of result) {
      // Debtor pays amount → their negative position moves toward 0 (net becomes more positive).
      totals.set(d.fromName, (totals.get(d.fromName) ?? 0) + d.amountCents);
      // Creditor receives amount → their positive position moves toward 0.
      totals.set(d.toName, (totals.get(d.toName) ?? 0) - d.amountCents);
    }
    expect(totals.get("A")).toBe(3333);
    expect(totals.get("B")).toBe(-1000);
    expect(totals.get("C")).toBe(-2333);
  });

  it("skips players with zero net position (rounding threshold)", () => {
    // Anything within 1 cent is treated as zero.
    const result = computePairwiseDebts([
      { playerName: "A", netCents: -100 },
      { playerName: "B", netCents: 0 },
      { playerName: "C", netCents: 100 },
    ]);
    // B is at zero, should not appear.
    expect(result.find((d) => d.fromName === "B" || d.toName === "B")).toBeUndefined();
  });
});
