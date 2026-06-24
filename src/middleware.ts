import { defineMiddleware } from "astro:middleware";

/**
 * Security middleware: CSRF protection + security headers (CSP, etc.)
 *
 * CSRF: Validates the Origin header on state-changing requests (POST, PUT, PATCH, DELETE)
 * to prevent cross-site request forgery attacks on session-authenticated endpoints.
 *
 * Bypasses:
 * - GET/HEAD/OPTIONS requests (safe methods)
 * - /api/auth/* routes (handled by better-auth's trustedOrigins)
 * - /api/oauth-callback (testing utility)
 * - Requests with Bearer tokens (API keys / OAuth — not session-based)
 * - Requests without cookies (no session to exploit)
 */

const BYPASS_PREFIXES = [
  "/api/auth/",       // better-auth handles its own CSRF
  "/api/oauth-callback", // testing utility
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Security headers applied to all responses */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  // X-Frame-Options: SAMEORIGIN (not DENY) so Astro's ClientRouter can load
  // the next page in a hidden same-origin iframe to render its client:only
  // islands during the view transition. External framing is still blocked by
  // the CSP frame-ancestors directive below.
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://maps.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://*.tile.openstreetmap.org https://maps.googleapis.com https://maps.gstatic.com",
    "connect-src 'self' https://maps.googleapis.com",
    // frame-ancestors 'self' (not 'none') so Astro's ClientRouter can embed
    // the next page in a same-origin hidden iframe while preparing the view
    // transition. External framing is still blocked.
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

/**
 * If the request arrived on a non-canonical host, return a redirect Response
 * to the canonical host (preserving path + query); otherwise null.
 *
 * Canonical host comes from BETTER_AUTH_URL. The public host is derived from
 * proxy headers (Fly terminates TLS and proxies to localhost:3000, so url.host
 * is the internal address, not what the user typed).
 *
 * - GET/HEAD → 301 (permanent, cacheable)
 * - other methods → 308 (permanent, preserves method + body)
 * Localhost / hostless requests are never redirected (dev + non-browser).
 */
function canonicalHostRedirect(request: Request, url: URL): Response | null {
  const canonicalUrl = process.env.BETTER_AUTH_URL;
  if (!canonicalUrl) return null;

  let canonicalHost: string;
  try {
    canonicalHost = new URL(canonicalUrl).host;
  } catch {
    return null;
  }

  // If the canonical host is localhost (dev/test), don't redirect anything —
  // we'd otherwise bounce real traffic to localhost.
  const canonicalLower = canonicalHost.toLowerCase();
  if (canonicalLower.startsWith("localhost") || canonicalLower.startsWith("127.0.0.1")) return null;

  const publicHost = (request.headers.get("x-forwarded-host")
    ?? request.headers.get("host")
    ?? url.host).toLowerCase();

  if (!publicHost) return null;
  // Never redirect local dev or the internal proxy address.
  if (publicHost.startsWith("localhost") || publicHost.startsWith("127.0.0.1")) return null;
  if (publicHost === canonicalLower) return null;

  const proto = (request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")) || "https";
  const location = `${proto === "http" ? "https" : proto}://${canonicalHost}${url.pathname}${url.search}`;
  const status = request.method === "GET" || request.method === "HEAD" ? 301 : 308;
  return new Response(null, { status, headers: { Location: location } });
}

function addSecurityHeaders(response: Response): Response {
  try {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(key)) {
        response.headers.set(key, value);
      }
    }
    return response;
  } catch {
    // Responses created via Response.redirect() have immutable headers,
    // so set() throws. Rebuild with a mutable copy (preserves status + Location).
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

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;

  // ── Canonical host redirect (Option B) ────────────────────────────────────
  // Force a single canonical origin so the session cookie is never split
  // across domains (e.g. convocados.fly.dev vs convocados.cabeda.dev). Without
  // this, an OAuth round-trip started on the non-canonical host returns to the
  // canonical host (BETTER_AUTH_URL) and the cookie lands on the wrong domain,
  // leaving the user on the main page logged out.
  const canonicalRedirect = canonicalHostRedirect(request, url);
  if (canonicalRedirect) return canonicalRedirect;

  // Safe methods don't need CSRF protection
  if (SAFE_METHODS.has(request.method)) {
    const response = await next();
    return addSecurityHeaders(response);
  }

  // Bypass for auth routes (better-auth handles its own CSRF via trustedOrigins)
  const pathname = url.pathname;
  if (BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const response = await next();
    return addSecurityHeaders(response);
  }

  // Bypass for Bearer-authenticated requests (API keys / OAuth tokens)
  // These are not vulnerable to CSRF since the attacker can't inject the header
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const response = await next();
    return addSecurityHeaders(response);
  }

  // Bypass if no cookies present (no session to exploit)
  if (!request.headers.get("cookie")) {
    const response = await next();
    return addSecurityHeaders(response);
  }

  // Validate Origin header for session-authenticated mutations
  const origin = request.headers.get("origin");
  if (!origin) {
    // No Origin header — some legitimate clients (curl, Postman) don't send it.
    // Allow if there's no Sec-Fetch-Site header (non-browser client).
    // Browsers always send Origin on cross-origin POST requests.
    const secFetchSite = request.headers.get("sec-fetch-site");
    if (!secFetchSite || secFetchSite === "same-origin" || secFetchSite === "none") {
      const response = await next();
      return addSecurityHeaders(response);
    }
    // Browser cross-origin request without Origin — block it
    return new Response("Forbidden: missing Origin header", { status: 403 });
  }

  // Compare origin to the request URL's origin.
  // Behind a reverse proxy (e.g. Fly.dev), url.origin is the internal address
  // (http://localhost:3000), so we also derive the public origin from forwarded headers.
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const publicOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;

  const allowedOrigins = new Set([
    url.origin,
    // Public origin derived from proxy headers
    ...(publicOrigin ? [publicOrigin] : []),
    // Allow configured trusted origins
    ...(process.env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ]);

  if (allowedOrigins.has(origin)) {
    const response = await next();
    return addSecurityHeaders(response);
  }

  // Origin mismatch — block the request
  return new Response("Forbidden: origin mismatch", { status: 403 });
});
