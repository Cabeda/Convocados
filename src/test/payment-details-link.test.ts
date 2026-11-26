import { describe, it, expect } from "vitest";
import {
  PAYMENT_DETAILS_HASH,
  payerPaymentDetailsPath,
} from "~/lib/paymentDetailsLink";

describe("payerPaymentDetailsPath", () => {
  it("builds the one link the assignment push and the payer card share", () => {
    expect(payerPaymentDetailsPath("user-1")).toBe(
      `/users/user-1#${PAYMENT_DETAILS_HASH}`,
    );
  });

  it("encodes the id as a path segment", () => {
    expect(payerPaymentDetailsPath("a/b c")).toBe(
      "/users/a%2Fb%20c#payment-details",
    );
  });
});
