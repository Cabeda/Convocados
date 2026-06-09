/**
 * PWA install helpers.
 *
 * iOS Safari exposes no programmatic "Add to Home Screen" (A2HS) API and never
 * fires `beforeinstallprompt`. The closest we can do from a web page is open the
 * native share sheet via the Web Share API — that sheet contains the
 * "Add to Home Screen" action. This helper performs that best-effort trigger.
 */

export interface ShareCapableNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
}

export type ShareOutcome = "shared" | "unsupported" | "cancelled";

/**
 * Opens the native share sheet so the user can tap "Add to Home Screen".
 *
 * @returns
 *  - `"shared"` when the share sheet was successfully invoked,
 *  - `"cancelled"` when the user dismissed it or the share failed,
 *  - `"unsupported"` when the Web Share API is unavailable (caller should fall
 *    back to showing manual instructions).
 */
export async function shareForHomeScreen(
  nav: ShareCapableNavigator,
  url: string,
  title: string,
): Promise<ShareOutcome> {
  if (typeof nav?.share !== "function") return "unsupported";
  try {
    await nav.share({ title, url });
    return "shared";
  } catch {
    // User cancelled the share sheet or the share was rejected — not an error
    // we need to surface, the banner simply stays put.
    return "cancelled";
  }
}
