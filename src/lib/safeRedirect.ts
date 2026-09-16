/**
 * Same-origin redirect safety.
 *
 * `callbackURL` arrives from the query string, so it is attacker-controllable:
 * a crafted sign-in link can bounce a freshly authenticated user to another
 * origin (phishing). A naive "starts with `/` but not `//`" guard is not
 * enough — the WHATWG URL parser treats `\` as `/` for special schemes, so
 * `/\evil.com` resolves to the protocol-relative `//evil.com`. Resolving
 * against the app origin and requiring an origin match closes that class of
 * bypass (backslashes, scheme-relative URLs, `javascript:`, `data:`, encoded
 * variants) without keeping a denylist of tricks.
 */

/** Resolve `value` to a path on `base`, or null when it lands elsewhere. */
function toSameOriginPath(value: string, base: string): string | null {
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    return null;
  }
  try {
    const url = new URL(value, baseUrl);
    // Non-special schemes (`javascript:`, `data:`) report origin "null".
    if (url.origin !== baseUrl.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export interface SanitizeCallbackUrlOptions {
  /** Returned when `raw` is absent or not same-origin. Sanitized too. */
  fallback?: string;
  /** Origin to resolve against. Defaults to the current window origin. */
  base?: string;
}

const DEFAULT_FALLBACK = "/";

/**
 * Return a safe, same-origin path for a user-supplied `callbackURL`.
 *
 * Absolute same-origin URLs are reduced to their path; anything pointing at a
 * different origin (including protocol-relative and backslash-normalized
 * forms) falls back to `fallback` (`/`). The fallback is itself validated, so
 * a caller cannot smuggle a cross-origin value through it.
 */
export function sanitizeCallbackUrl(
  raw: string | null | undefined,
  options: SanitizeCallbackUrlOptions = {},
): string {
  const base = options.base ?? (typeof window !== "undefined" ? window.location.origin : undefined);
  // Without a real origin we cannot prove a value is same-origin, so only the
  // default fallback is safe.
  if (!base) return DEFAULT_FALLBACK;

  const requested = raw ? toSameOriginPath(raw, base) : null;
  if (requested !== null) return requested;

  const fallback = options.fallback ?? DEFAULT_FALLBACK;
  return toSameOriginPath(fallback, base) ?? DEFAULT_FALLBACK;
}
