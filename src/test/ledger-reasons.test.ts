import { describe, it, expect } from "vitest";
import {
  LEDGER_REASONS,
  UNIT_AFFECTING_REASONS,
  MONEY_CHARGING_REASONS,
  MONEY_CLEARING_REASONS,
  OUTSTANDING_CLEARING_REASONS,
} from "~/lib/wallet";

/**
 * The ledger reason registry is the single classification of a money movement
 * (ADR 0006/0019). These expectations are the spec; the sets are derived from it.
 */
describe("ledger reason registry", () => {
  it("classifies each reason", () => {
    expect(LEDGER_REASONS.per_game_share).toEqual({ unitAffecting: false, charging: true, moneyClearing: false, outstandingClearing: false });
    expect(LEDGER_REASONS.cost_adjustment).toEqual({ unitAffecting: false, charging: true, moneyClearing: false, outstandingClearing: false });
    expect(LEDGER_REASONS.monthly_fee).toEqual({ unitAffecting: false, charging: false, moneyClearing: false, outstandingClearing: false });
    expect(LEDGER_REASONS.missed_game_credit).toEqual({ unitAffecting: true, charging: false, moneyClearing: false, outstandingClearing: false });
    expect(LEDGER_REASONS.credit_redeemed).toEqual({ unitAffecting: true, charging: false, moneyClearing: true, outstandingClearing: true });
    expect(LEDGER_REASONS.credit_expired).toEqual({ unitAffecting: true, charging: false, moneyClearing: false, outstandingClearing: false });
    expect(LEDGER_REASONS.extras_declare).toEqual({ unitAffecting: false, charging: false, moneyClearing: false, outstandingClearing: false });
    expect(LEDGER_REASONS.payment_received).toEqual({ unitAffecting: false, charging: false, moneyClearing: true, outstandingClearing: true });
    expect(LEDGER_REASONS.payment_self_reported).toEqual({ unitAffecting: false, charging: false, moneyClearing: true, outstandingClearing: false });
    expect(LEDGER_REASONS.game_cancelled_credit).toEqual({ unitAffecting: false, charging: false, moneyClearing: true, outstandingClearing: true });
  });

  it("derives the classification sets from the registry", () => {
    expect([...UNIT_AFFECTING_REASONS].sort()).toEqual(["credit_expired", "credit_redeemed", "missed_game_credit"]);
    expect([...MONEY_CHARGING_REASONS].sort()).toEqual(["cost_adjustment", "per_game_share"]);
    expect([...MONEY_CLEARING_REASONS].sort()).toEqual(["credit_redeemed", "game_cancelled_credit", "payment_received", "payment_self_reported"]);
    expect([...OUTSTANDING_CLEARING_REASONS].sort()).toEqual(["credit_redeemed", "game_cancelled_credit", "payment_received"]);
  });
});
