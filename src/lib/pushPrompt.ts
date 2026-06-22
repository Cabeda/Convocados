/**
 * Push prompt + install banner coordination.
 *
 * Single source of truth for "which banner wins" on a given page render.
 * Replaces the ad-hoc logic previously split between ResponsiveLayout's
 * InstallBanner and PushPromptBanner so they can no longer fight for
 * the same bottom-of-screen slot.
 *
 * Pure functions only — safe to import from server or client and easy to unit test.
 */

export type PermissionState = "default" | "granted" | "denied" | "unsupported";

export type ActiveBanner = "install" | "push" | "none";

export interface BannerContext {
  /** display-mode: standalone OR navigator.standalone === true */
  isStandalone: boolean;
  /** User agent matches iPad / iPhone / iPod */
  isIos: boolean;
  /** Notification.permission snapshot */
  permission: PermissionState;
  /** Install banner was dismissed by the user within the 7-day cooldown */
  installDismissed: boolean;
  /** PushPromptBanner's internal visibility check passed (cooldown, follow gate, etc.) */
  pushPromptVisible: boolean;
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

/**
 * Resolve which banner (if any) should render for the current page state.
 *
 * Priority rules:
 *  1. Standalone PWA — no banner (the app is "installed").
 *  2. iOS + push granted — no banner (user is on this device, already opted in).
 *  3. Permission granted on desktop — install banner still useful for
 *     "add to home screen for app-like UX"; push is moot.
 *  4. Permission denied — push banner is terminal (don't re-prompt). Keep
 *     install banner on desktop only — on iOS the install path is the
 *     *only* recovery vector.
 *  5. Permission default + iOS — install banner wins because push only
 *     works after the PWA is added to Home Screen.
 *  6. Permission default + desktop — push banner wins.
 *  7. Dismissal flags override the candidate when the user already rejected it.
 */
export function pickActiveBanner(ctx: BannerContext): ActiveBanner {
  if (ctx.isStandalone) return "none";

  // Push already granted — no need to nag.
  if (ctx.permission === "granted") {
    return ctx.isIos ? "none" : "install";
  }

  // Push denied — terminal. The denied-state Alert inside PushPromptBanner
  // is what shows. Keep install banner for desktop users.
  if (ctx.permission === "denied") {
    if (ctx.isIos) return ctx.isStandalone ? "none" : "install";
    return "install";
  }

  // Permission default / unsupported.
  if (ctx.permission === "default" || ctx.permission === "unsupported") {
    if (ctx.isIos) {
      // iOS: install is a prerequisite for push. Show install first.
      return ctx.installDismissed && ctx.pushPromptVisible ? "push" : "install";
    }
    // Desktop: push is the direct win.
    if (ctx.pushPromptVisible && !ctx.installDismissed) return "push";
    if (ctx.pushPromptVisible) return "push";
    if (!ctx.installDismissed) return "install";
    return "none";
  }

  return "none";
}
