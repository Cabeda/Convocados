/**
 * Pure predicate for the app-open heartbeat.
 *
 * A user counts as "active" once per UTC day (see `recordAppOpen`). The
 * heartbeat should only fire for real page navigations — an HTML GET carrying
 * a session cookie — so the middleware never pays a session lookup for API
 * calls, static assets, or non-browser clients.
 */

/** Paths that are never page navigations worth counting. */
const SKIP_PREFIXES = ["/api/", "/_", "/icons/"];

export function isTrackableAppOpen(request: Request, url: URL): boolean {
  if (request.method !== "GET") return false;
  if (!request.headers.get("cookie")) return false;
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) return false;
  return !SKIP_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}
