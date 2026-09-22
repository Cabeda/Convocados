import { describe, it, expect } from "vitest";
import { summarizePayments } from "~/lib/paymentSummary";

describe("summarizePayments", () => {
  it("treats an empty roll as fully paid", () => {
    expect(summarizePayments([])).toEqual({
      paidCount: 0,
      pendingCount: 0,
      totalCount: 0,
      paidAmount: 0,
      outstandingAmount: 0,
      allPaid: true,
    });
  });

  it("counts paid and pending rows and sums the paid amount", () => {
    const summary = summarizePayments([
      { status: "paid", amount: 10 },
      { status: "pending", amount: 5 },
      { status: "sent", amount: 5 },
      { status: "paid", amount: 2.5 },
    ]);
    expect(summary).toEqual({
      paidCount: 2,
      pendingCount: 1,
      totalCount: 4,
      paidAmount: 12.5,
      outstandingAmount: 10,
      allPaid: false,
    });
  });

  it("does not treat `sent` as settled (ADR 0006)", () => {
    const summary = summarizePayments([{ status: "sent", amount: 5 }]);
    expect(summary.paidCount).toBe(0);
    expect(summary.allPaid).toBe(false);
    expect(summary.paidAmount).toBe(0);
  });

  it("reports allPaid when every row is paid", () => {
    expect(summarizePayments([{ status: "paid", amount: 1 }, { status: "paid", amount: 2 }]).allPaid).toBe(true);
  });

  it("tolerates rows without an amount", () => {
    expect(summarizePayments([{ status: "paid" }]).paidAmount).toBe(0);
  });
});
