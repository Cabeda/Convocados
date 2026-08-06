/** Money display helpers shared by payment surfaces. */

export type PaymentStatus = "pending" | "sent" | "paid";

/** Format an amount in the event currency, e.g. `50.00EUR`. */
export function formatMoney(amount: number, currency = "EUR"): string {
  return `${amount.toFixed(2)}${currency}`;
}

/** Short date label, e.g. "5 Aug". */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(iso));
}
