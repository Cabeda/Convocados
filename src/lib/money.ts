/** Money display helpers shared by payment surfaces. */

export type PaymentStatus = "pending" | "sent" | "paid";

/** Currencies the app names by symbol. Anything else renders as its own ISO code. */
const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", BRL: "R$" };

/**
 * The one money format: amount with two decimals, then the currency symbol, no
 * space — `50.00€`. Every surface renders money through this.
 *
 * `cents` is an integer (ADR 0007's ledger unit), so no money arithmetic happens
 * in floats; `toCents` is the one boundary that converts a legacy float amount.
 *
 * A currency with no known symbol renders as its own upper-cased code (`50.00XYZ`):
 * a code is unambiguous where a guessed symbol would misstate the amount. A
 * missing currency falls back to EUR, the `EventCost.currency` default.
 */
export function formatMoney(cents: number, currency?: string | null): string {
  const code = currency?.trim().toUpperCase() || "EUR";
  return `${(cents / 100).toFixed(2)}${CURRENCY_SYMBOLS[code] ?? code}`;
}

/**
 * The quiet money format for the story cards: whole amounts without decimals
 * (`€5`), fractional ones with two (`€2.50`), the currency's narrow symbol placed
 * where the locale expects it. `formatMoney` stays the format of every other
 * surface; this one is for sentences, not ledgers.
 *
 * `amount` is in major units. It is rounded to cents first, so `0.1 + 0.2` reads `€0.30`.
 */
export function formatMoneyCompact(amount: number, currency: string | null | undefined, locale: string): string {
  const code = currency?.trim().toUpperCase() || "EUR";
  const rounded = Math.round(amount * 100) / 100;
  const whole = Number.isInteger(rounded);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency", currency: code, currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
    }).format(rounded);
  } catch {
    // An unknown locale or a malformed currency code: say it plainly in the one format we trust.
    return formatMoney(toCents(rounded), code);
  }
}

/** Boundary conversion for the legacy float amounts (`EventCost.totalAmount`, `PlayerPayment.amount`). */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Short date label, e.g. "5 Aug". */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(iso));
}
