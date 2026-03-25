/**
 * OAuth 2.1 + API key scope definitions.
 *
 * These scopes are used by both OAuth tokens and API keys.
 * The OIDC standard scopes (openid, profile, email, offline_access)
 * are handled by better-auth automatically.
 */

/** All application-specific scopes */
export const APP_SCOPES = [
  "read:profile",
  "read:events",
  "write:events",
  "create:events",
  "manage:players",
  "read:ratings",
  "read:history",
  "manage:teams",
  "manage:webhooks",
  "manage:push",
  "read:calendar",
  "manage:payments",
] as const;

export type AppScope = (typeof APP_SCOPES)[number];

/** OIDC standard scopes */
export const OIDC_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
] as const;

/** All scopes supported by the OAuth provider */
export const OAUTH_SCOPES: string[] = [...OIDC_SCOPES, ...APP_SCOPES];

/** Human-readable scope descriptions (for consent screen) */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: "Verify your identity",
  profile: "View your basic profile",
  email: "View your email address",
  offline_access: "Stay signed in (refresh tokens)",
  "read:profile": "View your profile",
  "read:events": "View your events",
  "write:events": "Modify event settings",
  "create:events": "Create new events",
  "manage:players": "Add and remove players",
  "read:ratings": "View ELO ratings",
  "read:history": "View game history",
  "manage:teams": "Randomize and assign teams",
  "manage:webhooks": "Manage webhooks",
  "manage:push": "Manage push subscriptions",
  "read:calendar": "Access calendar feeds",
  "manage:payments": "Manage costs and payments",
};

/** Check if a scope string contains a required scope */
export function hasScope(scopes: string | string[], required: string): boolean {
  const list = Array.isArray(scopes) ? scopes : scopes.split(" ");
  return list.includes(required);
}

/** Check if a scope string contains all required scopes */
export function hasAllScopes(scopes: string | string[], required: string[]): boolean {
  return required.every((s) => hasScope(scopes, s));
}
