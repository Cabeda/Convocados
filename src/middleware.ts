import { defineMiddleware } from "astro:middleware";
import { applySecurityHeaders as addSecurityHeaders } from "~/lib/securityHeaders";
import { isTrackableAppOpen } from "~/lib/appOpen";
import { canonicalHostRedirect as decideCanonicalRedirect } from "~/lib/canonicalHost.mjs";
import { logger } from "~/lib/logger.server";

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
 *
 * Prerendered routes never reach this middleware (they are served as static
 * files), so the same header map is also serialized to `dist/_headers.json` at
 * build time by `src/integrations/staticSecurityHeaders.ts`.
 */

const BYPASS_PREFIXES = [
  "/api/auth/",       // better-auth handles its own CSRF
  "/api/oauth-callback", // testing utility
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Paths that a failing connector crosses; traced for diagnosis. */
const TRACE_PREFIXES = ["/api/mcp", "/api/auth/oauth2"];

/**
 * Middleware adapter for the shared rule in `~/lib/canonicalHost.mjs`, which
 * `scripts/server.mjs` also applies before Astro. That wrapper catches
 * prerendered pages, static files and route-cache hits (middleware never sees
 * them); this copy covers dynamic routes in dev and without the wrapper.
 */
function canonicalHostRedirect(request: Request, url: URL): Response | null {
  const headers: Record<string, string> = Object.fromEntries(request.headers);
  // A constructed Request has no Host header; fall back to the URL's host so
  // the rule still has a public host to compare (production always sets one).
  headers.host ??= url.host;

  const decision = decideCanonicalRedirect({
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers,
  });
  if (!decision) return null;

  // `no-store` keeps browsers from heuristically caching the 301. The route
  // cache is handled by the caller, which opts out before returning.
  return addSecurityHeaders(
    new Response(null, {
      status: decision.status,
      headers: { Location: decision.location, "Cache-Control": decision.cacheControl },
    }),
  );
}

/**
 * CSRF gate for state-changing requests: the rejection to send, or null when
 * the request may proceed. Kept as one function so the OAuth/MCP trace below
 * cannot bypass it — the trace wraps `next()`, and a copy of these rules is
 * exactly how a security check silently disappears.
 */
function csrfRejection(request: Request, url: URL): Response | null {
  // Bypass for auth routes (better-auth handles its own CSRF via trustedOrigins)
  const pathname = url.pathname;
  if (BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  // Bypass for Bearer-authenticated requests (API keys / OAuth tokens)
  // These are not vulnerable to CSRF since the attacker can't inject the header
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return null;

  // Bypass if no cookies present (no session to exploit)
  if (!request.headers.get("cookie")) return null;

  // Validate Origin header for session-authenticated mutations
  const origin = request.headers.get("origin");
  if (!origin) {
    // No Origin header — some legitimate clients (curl, Postman) don't send it.
    // Allow if there's no Sec-Fetch-Site header (non-browser client).
    // Browsers always send Origin on cross-origin POST requests.
    const secFetchSite = request.headers.get("sec-fetch-site");
    if (!secFetchSite || secFetchSite === "same-origin" || secFetchSite === "none") return null;
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

  if (allowedOrigins.has(origin)) return null;

  // Origin mismatch — block the request
  return new Response("Forbidden: origin mismatch", { status: 403 });
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
  if (canonicalRedirect) {
    // A host redirect must never enter the route cache. The cache is keyed by
    // path (not host), so a redirect stored from a convocados.fly.dev request is
    // served back to convocados.cabeda.dev and points at itself — every event
    // link opened on the old host loops with ERR_TOO_MANY_REDIRECTS.
    context.cache?.set(false);
    return canonicalRedirect;
  }

  // ── OAuth / MCP connectivity trace ────────────────────────────────────────
  // A connector that completes OAuth and then still fails is undebuggable from
  // the outside: the app logged nothing per request and Fly keeps no request
  // log (docs/runbooks/production-inspection.md). One structured line per
  // OAuth or MCP request names the hop and the status that failed.
  if (TRACE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    const startedAt = Date.now();
    // The gate runs first: tracing must never be a way around CSRF.
    const rejection = SAFE_METHODS.has(request.method) ? null : csrfRejection(request, url);
    const response = rejection ?? (await next());
    logger.info(
      {
        method: request.method,
        path: url.pathname,
        status: response.status,
        ms: Date.now() - startedAt,
        auth: request.headers.get("authorization") ? "bearer" : "none",
        mcpVersion: request.headers.get("mcp-protocol-version") ?? undefined,
        accept: request.headers.get("accept") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
      "oauth/mcp request",
    );
    return rejection ?? addSecurityHeaders(response);
  }

  // Safe methods don't need CSRF protection
  if (SAFE_METHODS.has(request.method)) {
    const response = await next();
    // App-open heartbeat: count authenticated page navigations once per UTC
    // day (drives admin DAU/WAU/MAU + the push-prompt accelerator). Deliberately
    // fire-and-forget — it must never delay or fail the response.
    if (isTrackableAppOpen(request, url)) {
      void import("~/lib/appOpen.server").then((m) => m.trackAppOpen(request));
    }
    return addSecurityHeaders(response);
  }

  // Bypasses (auth routes, bearer tokens, cookieless clients) live inside the
  // gate, so this is the single place a state-changing request is judged.
  const rejection = csrfRejection(request, url);
  if (rejection) return rejection;
  const response = await next();
  return addSecurityHeaders(response);
});
