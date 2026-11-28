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
 * The address people should pass on: the page itself, never its query. A link with `?inviteToken`
 * opens a password-locked game, so it must not travel in a share.
 */
export function shareableUrl(location: Pick<Location, "origin" | "pathname">): string {
  return `${location.origin}${location.pathname}`;
}

export type ShareOutcome = "shared" | "copied" | "dismissed";

/**
 * Open the native share sheet, falling back to the clipboard when the platform has no
 * Web Share API. "dismissed" means the person closed the sheet: nothing was shared or copied.
 * A clipboard refusal is thrown so the caller can say how to copy by hand.
 */
export async function shareEvent(payload: { title: string; text: string; url: string }): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return "dismissed";
      // The share sheet itself failed: fall through to the clipboard.
    }
  }

  await navigator.clipboard.writeText(payload.url);
  return "copied";
}
