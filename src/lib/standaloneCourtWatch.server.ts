/**
 * Standalone recurring court watch logic.
 * A watch targets a specific Playtomic court on a recurring weekday + time window.
 * Matching is performed against the court's local time (what Playtomic returns).
 */

import { getAvailability } from "./playtomic.server";

export interface CourtWatchInput {
  sport: string;
  tenantId: string;
  resourceId: string | null; // null = any court at the club
  dayOfWeek: number;         // 0=Sun .. 6=Sat
  startTime: string;         // "HH:mm" (club-local)
  endTime: string;           // "HH:mm" (club-local)
  durationMinutes: number;
  maxPrice?: number | null;
}

export interface CourtWatchMatch {
  resourceId: string;
  resourceName: string;
  slotDate: string; // "YYYY-MM-DD"
  slotTime: string; // "HH:mm"
  duration: number;
  price: number | null;
  currency: string | null;
}

/** Parse "HH:mm[:ss]" to minutes since midnight. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Format a Date (UTC) to "YYYY-MM-DD". */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Return upcoming dates (YYYY-MM-DD) matching the given weekday within the
 * lookahead window, starting from `from` (inclusive of today if it matches).
 */
export function upcomingDatesForWeekday(
  dayOfWeek: number,
  lookaheadDays: number,
  from: Date = new Date(),
): string[] {
  const dates: string[] = [];
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let i = 0; i <= lookaheadDays; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    if (d.getUTCDay() === dayOfWeek) dates.push(toDateStr(d));
  }
  return dates;
}

/**
 * Find available slots matching a watch across upcoming dates.
 * Queries Playtomic availability per date and filters to the watched court,
 * the time window and duration (and maxPrice when set).
 */
export async function findWatchMatches(
  watch: CourtWatchInput,
  options: { lookaheadDays?: number; from?: Date } = {},
): Promise<{ matches: CourtWatchMatch[]; error?: string }> {
  const lookaheadDays = options.lookaheadDays ?? 14;
  const dates = upcomingDatesForWeekday(watch.dayOfWeek, lookaheadDays, options.from);
  if (dates.length === 0) return { matches: [] };

  const windowStart = timeToMinutes(watch.startTime);
  const windowEnd = timeToMinutes(watch.endTime);
  const matches: CourtWatchMatch[] = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const { courts, error } = await getAvailability({
      tenantId: watch.tenantId,
      date,
      sport: watch.sport,
      duration: watch.durationMinutes,
    });
    if (error) return { matches, error };

    for (const court of courts) {
      if (watch.resourceId && court.resource_id !== watch.resourceId) continue;
      for (const slot of court.slots) {
        const slotMin = timeToMinutes(slot.start_time);
        if (slotMin < windowStart || slotMin > windowEnd) continue;
        if (slot.duration < watch.durationMinutes) continue;
        if (watch.maxPrice !== null && watch.maxPrice !== undefined && slot.price !== null && slot.price > watch.maxPrice) continue;
        matches.push({
          resourceId: court.resource_id,
          resourceName: court.resource_name,
          slotDate: date,
          slotTime: slot.start_time.slice(0, 5),
          duration: slot.duration,
          price: slot.price,
          currency: slot.currency,
        });
      }
    }

    // Rate-limit between Playtomic calls
    if (i < dates.length - 1) await new Promise((r) => setTimeout(r, 200));
  }

  return { matches };
}
