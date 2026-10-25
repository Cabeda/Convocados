/**
 * Canonical-host redirect, decided at the HTTP layer.
 *
 * Astro's node adapter serves prerendered pages and static files without
 * running middleware, and the route cache can answer before middleware too.
 * Both bypassed the host redirect in `src/middleware.ts`, so the retired
 * `convocados.fly.dev` host kept serving pages with its own origin — a session
 * cookie scoped to the canonical host never follows, and sign-in bounces the
 * user to the other domain.
 *
 * `scripts/server.mjs` applies this before the Astro handler, so every response
 * on a non-canonical host redirects: pages, API routes, assets, cached
 * responses and prerendered files alike. Middleware delegates here as well, so
 * dev and dynamic routes make the same decision.
 *
 * The `Cache-Control: no-store` the caller sends is load-bearing: a cached 301
 * is harmless, but a browser that heuristically caches one keeps the host
 * pinned even after the server stops issuing it.
 */

/** @typedef {{ method?: string, url?: string, headers?: Record<string, string | string[] | undefined> }} RequestLike */

/**
 * App Links files that must be served in place on every host.
 * @type {ReadonlySet<string>}
 */
const APP_LINK_PATHS = new Set([
  "/.well-known/assetlinks.json",
  "/.well-known/apple-app-site-association",
]);

/**
 * Hosts that must keep working locally without bouncing to production.
 * @param {string} host
 */
function isLoopbackHost(host) {
  if (!host) return false;
  if (host === "[::1]" || host.startsWith("[::1]:")) return true;
  const name = host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1";
}

/**
 * @param {RequestLike} req
 * @param {string} [canonicalBaseUrl]
 * @returns {{ status: 301 | 308, location: string, cacheControl: "no-store" } | null}
 */
export function canonicalHostRedirect(req, canonicalBaseUrl = process.env.BETTER_AUTH_URL) {
  if (!canonicalBaseUrl) return null;

  let canonical;
  try {
    canonical = new URL(canonicalBaseUrl);
  } catch {
    return null;
  }

  const canonicalHost = canonical.host.toLowerCase();
  // Dev/test: a localhost canonical host would bounce real traffic to localhost.
  if (!canonicalHost || isLoopbackHost(canonicalHost)) return null;

  const forwarded = req.headers?.["x-forwarded-host"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const hostHeader = req.headers?.["host"];
  const firstHost = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const publicHost = String(firstForwarded ?? firstHost ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (!publicHost || isLoopbackHost(publicHost)) return null;
  if (publicHost === canonicalHost) return null;

  // Parse rather than concatenating req.url: a protocol-relative request target
  // (`//evil.example/x`) must not become an open redirect.
  let requestUrl;
  try {
    requestUrl = new URL(req.url ?? "/", "http://internal");
  } catch {
    return null;
  }
  const { pathname, search } = requestUrl;

  // Exempt the paths that must answer on the requested host:
  // - /api/health: Fly's HTTP check uses a non-public Host; a redirect fails
  //   the check and aborts the deploy.
  // - The two App Links files: Android and iOS require them to be served
  //   without redirects, and both hosts sit in the same autoVerify intent filter
  //   (Android ≤11 fails them all when one host does not verify).
  // Deliberately exact paths, not `/.well-known/*`: the OAuth discovery
  // documents advertise a canonical `issuer`, so they must keep redirecting to
  // the canonical host (RFC 8414 §3.3 matches the document to the issuer).
  if (pathname === "/api/health" || APP_LINK_PATHS.has(pathname)) return null;

  // Redirect to the configured canonical origin. Fly terminates TLS, and the
  // canonical URL is the source of truth for the scheme — a spoofed
  // X-Forwarded-Proto never reaches the Location header.
  const scheme = canonical.protocol === "http:" ? "http" : "https";
  const method = (req.method ?? "GET").toUpperCase();
  const status = method === "GET" || method === "HEAD" ? 301 : 308;

  return { status, location: `${scheme}://${canonicalHost}${pathname}${search}`, cacheControl: "no-store" };
}
