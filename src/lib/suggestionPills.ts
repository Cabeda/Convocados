/**
 * Suggestion pill composition (dex f79w7x29).
 *
 * Ranked co-play suggestions (/api/events/[id]/suggestions) are the primary
 * source, but they can come back empty — every candidate hard-excluded (rsvp
 * no, no-show streak, already pending-invited…). While the roster has room the
 * event page must still surface most-likely candidates, so fallback entries
 * (this event's known players + global co-players) fill the remaining slots.
 *
 * Pure functions — no DB/network access.
 */

export interface SuggestionPill {
  name: string;
  userId: string | null;
  image?: string | null;
  reason?: string;
}

export interface MergeSuggestionPillsOptions {
  /** Lower-cased names already on the roster — excluded from the pills. */
  currentNames?: Iterable<string>;
}

function dedupeKey(pill: SuggestionPill): string {
  return pill.userId ?? `name:${pill.name.toLowerCase()}`;
}

/**
 * Combine ranked + fallback suggestions into one deduplicated pill list.
 * Ranked entries win; duplicates are dropped by userId when linked, otherwise
 * by case-insensitive name (anonymous guests).
 */
export function mergeSuggestionPills(
  ranked: SuggestionPill[],
  fallback: SuggestionPill[],
  opts: MergeSuggestionPillsOptions = {},
): { pills: SuggestionPill[] } {
  const currentNames = new Set([...(opts.currentNames ?? [])].map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  const pills: SuggestionPill[] = [];
  for (const source of [ranked, fallback]) {
    for (const pill of source) {
      if (!pill.name?.trim()) continue;
      if (currentNames.has(pill.name.toLowerCase())) continue;
      const key = dedupeKey(pill);
      if (seen.has(key)) continue;
      seen.add(key);
      pills.push(pill);
    }
  }
  return { pills };
}
