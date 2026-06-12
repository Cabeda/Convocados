/**
 * Monthly subscription math — pure functions, no DB dependency.
 *
 * ADR 0008 — Monthly Subscription, Game Units, end-of-following-month expiry.
 *
 * A "Subscription Window" is a half-open interval [windowStart, windowEnd) in
 * the Event's timezone. The window aligns to calendar months. The expiry
 * date of a Game Unit earned in month M is the last instant of month M+1
 * in the same timezone (i.e. windowEnd of month M+1).
 */

export interface SubscriptionWindow {
  windowStart: Date;
  windowEnd: Date;
}

export interface SubscriptionLike {
  status: string;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Format a Date's year/month in a given IANA timezone, returning the
 * {year, month} pair (month is 1-12). Uses Intl.DateTimeFormat with the
 * `en-CA` locale because en-CA formats dates as YYYY-MM-DD, which is
 * trivially parseable.
 */
function yearMonthInTimezone(d: Date, timezone: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "NaN");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "NaN");
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
  return { year, month };
}

/**
 * Return the [windowStart, windowEnd) instant pair for the calendar month
 * containing `d` in `timezone`.
 *
 * windowStart = first instant of that month in `timezone`.
 * windowEnd   = first instant of the next month in `timezone`.
 *
 * Both are returned as `Date` objects that, when read in `timezone`, fall
 * on midnight on day 1 of the appropriate month.
 */
export function subscriptionWindowFor(d: Date, timezone: string): SubscriptionWindow {
  const { year, month } = yearMonthInTimezone(d, timezone);
  const windowStart = firstInstantOfMonth(year, month, timezone);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const windowEnd = firstInstantOfMonth(next.year, next.month, timezone);
  return { windowStart, windowEnd };
}

function firstInstantOfMonth(year: number, month: number, timezone: string): Date {
  // Build a date in the target timezone representing midnight on day 1, then
  // convert back to a UTC instant. We do this by binary search: the actual
  // UTC instant whose local-time representation in `timezone` is
  // YYYY-MM-DDT00:00:00.
  //
  // We approximate by formatting: take the UTC instant that is *at least*
  // midnight local time, then nudge backward if it overshoots. The max
  // offset between any two IANA zones is < 24h, so we search a 48h window.
  const targetLocal = `${year}-${String(month).padStart(2, "0")}-01T00:00:00`;
  const guessUtc = new Date(`${targetLocal}Z`);
  // Format `guessUtc` in `timezone` to see what local time it shows.
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(guessUtc);
  const get = (t: string) => Number(formatted.find((p) => p.type === t)?.value);
  const localYear = get("year");
  const localMonth = get("month");
  const localDay = get("day");
  const localHour = get("hour");
  const localMinute = get("minute");
  const localSecond = get("second");

  // Compute the offset between the local time shown and the target.
  // We represent both as epoch ms using a fixed reference: assume the local
  // wall-clock time is the same instant, so the offset =
  //   guessUtc - Date(UTC representation of local wall-clock time)
  const localAsUtc = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute, localSecond);
  const offsetMs = guessUtc.getTime() - localAsUtc;
  // `offsetMs` is the signed difference between guessUtc and the UTC instant
  // whose wall-clock time in `timezone` equals guessUtc's wall-clock time.
  // If Lisbon is UTC+1, guessUtc=00:00Z formats as 01:00 local, so
  // localAsUtc = 01:00Z, offsetMs = -1h. We need to shift guessUtc *by* that
  // offset to land on the UTC instant whose local time is 00:00.
  return new Date(guessUtc.getTime() + offsetMs);
}

export function isInSubscriptionWindow(d: Date, w: SubscriptionWindow): boolean {
  const t = d.getTime();
  return t >= w.windowStart.getTime() && t < w.windowEnd.getTime();
}

/**
 * The expiry instant of a Game Unit earned at `earnedAt`: end of the
 * calendar month following the month in which it was earned (in the
 * Event's timezone).
 *
 * Implemented as windowEnd of the *next-next* month of `earnedAt`:
 *   earned in month M → expires at windowEnd of month M+1.
 */
export function endOfExpiryMonth(earnedAt: Date, timezone: string): Date {
  const { year, month } = yearMonthInTimezone(earnedAt, timezone);
  // Move to month+1, then take its windowEnd.
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const nextNext = nextMonth.month === 12
    ? { year: nextMonth.year + 1, month: 1 }
    : { year: nextMonth.year, month: nextMonth.month + 1 };
  return firstInstantOfMonth(nextNext.year, nextNext.month, timezone);
}

/**
 * Does this subscription cover a game on the given date?
 * "Covers" = the subscription is `active` and the date is in [windowStart, windowEnd).
 */
export function activeSubscriptionCoversDate(
  subscription: SubscriptionLike,
  eventDate: Date,
): boolean {
  if (subscription.status !== "active") return false;
  return isInSubscriptionWindow(eventDate, {
    windowStart: subscription.windowStart,
    windowEnd: subscription.windowEnd,
  });
}
