/** The profile section where a Payer keeps the details the group pays them at. */
export const PAYMENT_DETAILS_HASH = "payment-details";

/**
 * The one builder for the link that sends a Payer to their payment details
 * (GH #1722). The assignment push and the payer card both use it so the next
 * target cannot drift from the screen that can actually open it.
 */
export function payerPaymentDetailsPath(userId: string): string {
  return `/users/${encodeURIComponent(userId)}#${PAYMENT_DETAILS_HASH}`;
}
