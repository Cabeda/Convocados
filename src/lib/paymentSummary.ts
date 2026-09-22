/**
 * Payment aggregate — the single definition of "how much of a payment roll is
 * settled". A row is settled when its status is `paid`; `sent` is a courtesy
 * signal and does NOT clear the balance (ADR 0006). An empty roll counts as
 * fully paid (nothing owed).
 *
 * Centralizes the `status === "paid"` reduction that was re-implemented in the
 * payments/cost routes, the post-game banner and the balance fallbacks.
 */

export interface PaymentStatusLike {
  status: string;
  amount?: number;
}

export interface PaymentAggregate {
  paidCount: number;
  pendingCount: number;
  totalCount: number;
  paidAmount: number;
  /** Total still owed: the sum of amounts on every row that is not `paid`. */
  outstandingAmount: number;
  /** True when nothing is owed: empty roll, or every row is `paid`. */
  allPaid: boolean;
}

export function summarizePayments(entries: readonly PaymentStatusLike[]): PaymentAggregate {
  let paidCount = 0;
  let pendingCount = 0;
  let paidAmount = 0;
  let outstandingAmount = 0;

  for (const entry of entries) {
    if (entry.status === "paid") {
      paidCount++;
      paidAmount += entry.amount ?? 0;
    } else {
      outstandingAmount += entry.amount ?? 0;
      if (entry.status === "pending") pendingCount++;
    }
  }

  const totalCount = entries.length;
  return {
    paidCount,
    pendingCount,
    totalCount,
    paidAmount,
    outstandingAmount,
    allPaid: totalCount === 0 || paidCount === totalCount,
  };
}
