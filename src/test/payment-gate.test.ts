import { describe, it, expect } from "vitest";
import { decidePaymentGate } from "~/lib/paymentGate";

const base = { isSelfService: true, outstandingAmount: 0, gateAmount: 0, threshold: 0 };

describe("decidePaymentGate", () => {
  it("allows when enforcement is off", () => {
    expect(decidePaymentGate({ ...base, enforcement: "off", outstandingAmount: 20, gateAmount: 20 })).toBe("allow");
  });

  it("allows manager-initiated adds regardless of debt", () => {
    expect(
      decidePaymentGate({ ...base, enforcement: "hard_gate", isSelfService: false, outstandingAmount: 50, gateAmount: 50 }),
    ).toBe("allow");
  });

  it("nudges a self-service joiner with a debt at the nudge level", () => {
    expect(decidePaymentGate({ ...base, enforcement: "nudge", outstandingAmount: 10, gateAmount: 10 })).toBe("nudge");
  });

  it("does not nudge when there is no debt", () => {
    expect(decidePaymentGate({ ...base, enforcement: "soft_gate" })).toBe("allow");
  });

  it("blocks at hard_gate when the gate balance exceeds the threshold", () => {
    expect(decidePaymentGate({ ...base, enforcement: "hard_gate", outstandingAmount: 10, gateAmount: 10, threshold: 0 })).toBe("block");
  });

  it("does not block at hard_gate when the gate balance is within the threshold", () => {
    expect(decidePaymentGate({ ...base, enforcement: "hard_gate", outstandingAmount: 10, gateAmount: 5, threshold: 5 })).toBe("nudge");
  });

  it("treats `sent` (gate cleared) as passable even with a strict outstanding balance", () => {
    expect(decidePaymentGate({ ...base, enforcement: "hard_gate", outstandingAmount: 10, gateAmount: 0, threshold: 0 })).toBe("nudge");
  });
});
