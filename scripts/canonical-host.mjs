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
 * Running the decision in `scripts/server.mjs`, before the Astro handler, makes
 * every response on a non-canonical host a redirect: pages, API routes, assets,
 * cached responses and prerendered files alike.
 *
 * The `Cache-Control: no-store` the caller sends is load-bearing: a cached 301
 * is harmless, but a browser that heuristically caches one keeps the host
 * pinned even after the server stops issuing it.
 */

/** @typedef {{ method?: string, url?: string, headers?: Record<string, string | string[] | undefined> }} RequestLike */

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
  if (!canonicalHost || canonicalHost.startsWith("localhost") || canonicalHost.startsWith("127.0.0.1")) {
    return null;
  }

  const forwarded = req.headers?.["x-forwarded-host"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const hostHeader = req.headers?.["host"];
  const firstHost = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const publicHost = String(firstForwarded ?? firstHost ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (!publicHost) return null;
  // Never redirect local dev or the internal proxy address.
  if (publicHost.startsWith("localhost") || publicHost.startsWith("127.0.0.1")) return null;
  if (publicHost === canonicalHost) return null;

  // Parse rather than concatenating req.url: a protocol-relative request target
  // (`//evil.example/x`) must not become an open redirect.
  let pathname = "/";
  let search = "";
  try {
    const requestUrl = new URL(req.url ?? "/", "http://internal");
    pathname = requestUrl.pathname;
    search = requestUrl.search;
  } catch {
    return null;
  }

  // Fly's HTTP check hits this with a non-public Host; redirecting it fails the
  // check and aborts the deploy.
  if (pathname === "/api/health") return null;

  const forwardedProto = req.headers?.["x-forwarded-proto"];
  const firstProto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const proto = String(firstProto ?? "https").split(",")[0].trim() || "https";
  const scheme = proto === "http" ? "https" : proto;

  const method = (req.method ?? "GET").toUpperCase();
  const status = method === "GET" || method === "HEAD" ? 301 : 308;

  return { status, location: `${scheme}://${canonicalHost}${pathname}${search}`, cacheControl: "no-store" };
}
