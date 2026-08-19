import { GITHUB_SPONSORS_URL, KO_FI_URL } from "~/components/SupportLinks";

/**
 * iOS release fundraising campaign.
 *
 * This is the single source of truth for the one-off campaign that funds the
 * $100 Apple Developer Program membership needed to publish the native iOS app.
 * The displayed raised total is a MANUALLY maintained value — it is not synced
 * live from Ko-fi. Update `raisedUsd` whenever the Ko-fi goal changes.
 *
 * The Ko-fi goal lives at https://ko-fi.com/cabeda/goal?g=20 ("Bring Convocados
 * to iPhone", target $100). We do not embed a Ko-fi widget or scrape it.
 */
export const IOS_CAMPAIGN = {
  /** Campaign target in USD. */
  targetUsd: 100,
  /** Raised so far in USD. Manually updated — see comment above. */
  raisedUsd: 0,
  /** Deep link to the live Ko-fi goal for this campaign. */
  koFiGoalUrl: "https://ko-fi.com/cabeda/goal?g=20",
  /** Shared support URLs (reused from SupportLinks). */
  koFiUrl: KO_FI_URL,
  githubSponsorsUrl: GITHUB_SPONSORS_URL,
} as const;

/**
 * Progress toward a fundraising target as a percentage, clamped to 0–100.
 * Returns 100 when the target is met or exceeded, 0 for a non-positive target.
 */
export function campaignProgressPercent(raisedUsd: number, targetUsd: number): number {
  if (targetUsd <= 0) return 0;
  const pct = Math.round((raisedUsd / targetUsd) * 100);
  return Math.min(100, Math.max(0, pct));
}
