/**
 * Payment gate decision — whether an outstanding balance should allow, nudge,
 * or block a join. The single definition of the enforcement policy (ADR 0006):
 *
 * - `off`, or a manager-initiated add: allow.
 * - `hard_gate`: block when the gate balance (where `sent` clears) exceeds the
 *   configured threshold.
 * - any other level with a debt: nudge (never blocks).
 *
 * `gateAmount` uses the gate-balance semantics (a self-reported `sent` clears
 * it); `outstandingAmount` uses the stricter balance (only `paid` clears).
 */
export type PaymentGateDecision = "allow" | "nudge" | "block";

export interface PaymentGateInput {
  /** `off` | `nudge` | `soft_gate` | `hard_gate` (unknown values are treated as nudge-like). */
  enforcement: string;
  /** Only self-service joins are gated; owner/admin adds bypass. */
  isSelfService: boolean;
  /** Strict outstanding balance in euros (`sent` does not clear). */
  outstandingAmount: number;
  /** Gate balance in euros (`sent` clears). */
  gateAmount: number;
  /** Per-event gate threshold in euros (default 0). */
  threshold: number;
}

export function decidePaymentGate(input: PaymentGateInput): PaymentGateDecision {
  if (!input.isSelfService || input.enforcement === "off") return "allow";
  if (input.enforcement === "hard_gate" && input.gateAmount > input.threshold) return "block";
  if (input.outstandingAmount > 0) return "nudge";
  return "allow";
}
