/**
 * Push prompt + install banner coordination helpers.
 *
 * Pure functions only — safe to import from server or client and easy to unit test.
 */

/** localStorage key + cooldown for the global "add to home screen" banner. */
export const INSTALL_BANNER_DISMISS_KEY = "pwa-install-dismissed";
export const INSTALL_BANNER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether the global install banner is still within its dismissal cooldown.
 * Shared so the push prompt can avoid duplicating the install message while the
 * install banner is already on screen.
 */
export function installBannerDismissed(
  storage: Pick<Storage, "getItem">,
  now: number = Date.now(),
): boolean {
  try {
    const raw = storage.getItem(INSTALL_BANNER_DISMISS_KEY);
    if (!raw) return false;
    const dismissed = parseInt(raw, 10);
    if (!Number.isFinite(dismissed)) return false;
    return now - dismissed < INSTALL_BANNER_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/** Detect iOS Safari — push is gated by PWA install on this platform. */
export function isIos(userAgent: string): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) && !/MSStream/.test(userAgent);
}

/** Resolve whether the app is running in standalone / PWA mode. */
export function isStandalone(opts: {
  displayModeStandalone: boolean;
  navigatorStandalone: boolean | undefined;
}): boolean {
  return opts.displayModeStandalone || opts.navigatorStandalone === true;
}

/**
 * Pick the deep link for the "enable notifications in browser settings" hint.
 *
 * - iOS Safari: anchor to our in-app notifications doc with a Safari anchor —
 *   iOS has no `chrome://` URL. The user has to navigate
 *   Settings > Safari > Notifications, and we explain that in copy.
 * - Firefox: `about:preferences#content-notifications`
 * - Chrome / Edge: `chrome://settings/content/notifications`
 * - Fallback: our docs page.
 */
export function resolveIosHelpLink(userAgent: string): string {
  if (/iPhone|iPad|iPod/.test(userAgent) && !/MSStream/.test(userAgent)) {
    return "/settings?focus=notifications#safari";
  }
  if (/Firefox/i.test(userAgent)) {
    return "about:preferences#content-notifications";
  }
  if (/Chrome|Edg/i.test(userAgent)) {
    return "chrome://settings/content/notifications";
  }
  return "/docs/push";
}
