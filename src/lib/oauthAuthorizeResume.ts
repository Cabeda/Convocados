/**
 * The OAuth authorization request better-auth handed to the login page.
 *
 * When the AS has no session it redirects to `/auth/signin?<signed query>`.
 * That query is the authorization request — it must be handed back to the
 * authorization endpoint after sign-in, or the request is lost: the user ends
 * up on the dashboard, no code is ever issued, and the client (Claude.ai,
 * ChatGPT) reports "Authentication failed".
 *
 * The signed marker (`sig`) is what tells this apart from an ordinary
 * `/auth/signin?callbackURL=…` deep link.
 */
export function oauthAuthorizeResumePath(search: string): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  if (params.get("response_type") !== "code") return null;
  if (!params.get("client_id") || !params.get("redirect_uri")) return null;
  if (!params.get("sig")) return null;

  // Keep the query byte-for-byte: the signature covers the parameter values,
  // and re-encoding could change them.
  return `/api/auth/oauth2/authorize?${raw}`;
}
