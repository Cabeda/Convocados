import { defineMiddleware } from "astro:middleware";

/**
 * CSRF protection middleware.
 *
 * Validates the Origin header on state-changing requests (POST, PUT, PATCH, DELETE)
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

export const onRequest = defineMiddleware((context, next) => {
  const { request, url } = context;

  // Safe methods don't need CSRF protection
  if (SAFE_METHODS.has(request.method)) {
    return next();
  }

  // Bypass for auth routes (better-auth handles its own CSRF via trustedOrigins)
  const pathname = url.pathname;
  if (BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return next();
  }

  // Bypass for Bearer-authenticated requests (API keys / OAuth tokens)
  // These are not vulnerable to CSRF since the attacker can't inject the header
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return next();
  }

  // Bypass if no cookies present (no session to exploit)
  if (!request.headers.get("cookie")) {
    return next();
  }

  // Validate Origin header for session-authenticated mutations
  const origin = request.headers.get("origin");
  if (!origin) {
    // No Origin header — some legitimate clients (curl, Postman) don't send it.
    // Allow if there's no Sec-Fetch-Site header (non-browser client).
    // Browsers always send Origin on cross-origin POST requests.
    const secFetchSite = request.headers.get("sec-fetch-site");
    if (!secFetchSite || secFetchSite === "same-origin" || secFetchSite === "none") {
      return next();
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
    return next();
  }

  // Origin mismatch — block the request
  return new Response("Forbidden: origin mismatch", { status: 403 });
});
