/**
 * Security headers, applied to every response.
 *
 * Two delivery paths share this map so they can never drift:
 *  - dynamic routes: `src/middleware.ts` sets them on the Response
 *  - prerendered routes: served as static files, which bypass middleware, so a
 *    build step serializes them into `dist/_headers.json` and the node adapter
 *    (`@astrojs/node` with `staticHeaders: true`) applies them at runtime.
 *
 * `frame-ancestors 'self'` (not 'none') and `X-Frame-Options: SAMEORIGIN` are
 * deliberate: Astro's ClientRouter loads the next page in a same-origin hidden
 * iframe during view transitions. External framing is still blocked.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://maps.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://*.tile.openstreetmap.org https://maps.googleapis.com https://maps.gstatic.com https://*.googleusercontent.com",
    "connect-src 'self' https://maps.googleapis.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

/**
 * Add the security headers to a Response without clobbering any the handler
 * already set. Returns a new Response when the original has immutable headers
 * (e.g. `Response.redirect()`), which throw on `set()`.
 */
export function applySecurityHeaders(response: Response): Response {
  try {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(key)) {
        response.headers.set(key, value);
      }
    }
    return response;
  } catch {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

/**
 * Map build-output HTML file paths to the URL pathnames the node adapter
 * matches against. Accepts paths relative to the client output directory.
 *
 *   index.html          -> /
 *   docs/index.html     -> /docs
 *   docs/about.html     -> /docs/about
 *   auth/signin.html    -> /auth/signin   (build.format: 'file')
 */
export function htmlFilesToPathnames(relativePaths: string[]): string[] {
  const pathnames = new Set<string>();
  for (const raw of relativePaths) {
    const normalized = raw.replace(/\\/g, "/").replace(/^\.?\//, "");
    if (!normalized.endsWith(".html")) continue;
    // Ignore error/asset pages that are not user-facing documents.
    if (normalized === "404.html" || normalized.startsWith("500")) continue;
    let pathname = normalized.slice(0, -".html".length);
    if (pathname === "index") {
      pathname = "";
    } else if (pathname.endsWith("/index")) {
      pathname = pathname.slice(0, -"/index".length);
    }
    pathnames.add(`/${pathname}`.replace(/\/{2,}/g, "/"));
  }
  return [...pathnames].sort();
}
