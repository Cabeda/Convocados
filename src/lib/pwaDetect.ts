/**
 * iOS PWA detection helpers.
 *
 * On iOS, a web page installed to the home screen runs in a special
 * "standalone" PWA context with its own cookie jar and localStorage.
 * The sign-in flow has to special-case this context because the OAuth
 * callback (which sets the session cookie) lands in a DIFFERENT
 * cookie jar (Safari) when the user is sent to `accounts.google.com`
 * for authentication.
 *
 * The window-navigator heuristics below cover the cases the app cares about:
 * - `isIosPwa` — iPhone/iPad user with the app installed from Safari
 * - `isIosSafariStandalone` — iPhone/iPad user in regular Safari (not installed)
 *
 * Detection is intentionally client-side and synchronous so it can be
 * evaluated in the same render pass as the auth UI.
 *
 * Note: each call reads `navigator.userAgent` at call time (not at module
 * load) so tests can stub the global navigator between calls.
 */

function getUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent ?? "";
}

/** True when running as an installed PWA on iOS. */
export function isIosPwa(): boolean {
  if (typeof window === "undefined") return false;
  const ua = getUserAgent();
  if (!/iPad|iPhone|iPod/.test(ua)) return false;
  // The PWA standalone display mode is set on iOS when the user taps
  // "Add to Home Screen" and opens the app from there.
  return "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

/** True when running in mobile Safari (not installed as a PWA). */
export function isIosSafariStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const ua = getUserAgent();
  if (!/iPad|iPhone|iPod/.test(ua)) return false;
  // On iOS Safari, the opposite of the PWA case: standalone is false.
  return !isIosPwa() && window.innerWidth <= 1024;
}

/** True for any iOS browser (PWA or Safari). */
export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(getUserAgent());
}
