import { formatDateInTz } from "~/lib/timezones";
import type { Locale } from "~/lib/i18n";

export interface EventShareDetails {
  title: string;
  dateTime: Date;
  timezone: string;
  location?: string | null;
  maxPlayers: number;
  playerCount: number;
  url: string;
}

export function buildEventShareText(
  details: EventShareDetails,
  locale: Locale,
  labels: { spotsLeft: (n: number) => string; full: string },
): string {
  const spotsLeft = details.maxPlayers - details.playerCount;
  const formattedDate = formatDateInTz(details.dateTime, locale, details.timezone, {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  return [
    `⚽ ${details.title}`,
    `📅 ${formattedDate}`,
    details.location && `📍 ${details.location}`,
    spotsLeft > 0 ? `👥 ${labels.spotsLeft(spotsLeft)}` : `👥 ${labels.full}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Open the native share sheet, falling back to the clipboard when the
 * platform has no Web Share API or the user dismisses it. Returns true when
 * the link was copied so the caller can surface the "link copied" snackbar.
 */
export async function shareEvent(payload: { title: string; text: string; url: string }): Promise<boolean> {
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  if (canShare) {
    try {
      await navigator.share(payload);
      return false;
    } catch {
      // Dismissed — fall through to the clipboard fallback.
    }
  }

  await navigator.clipboard.writeText(payload.url);
  return true;
}
