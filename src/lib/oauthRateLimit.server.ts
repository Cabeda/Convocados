/**
 * OAuth 2.1 rate limiting middleware.
 *
 * Applies rate limits to OAuth endpoints handled by better-auth's oidcProvider.
 * This is called before the auth handler to reject abusive requests early.
 */
import { rateLimitResponse } from "./apiRateLimit.server";
import type { RateLimitPreset } from "./apiRateLimit.server";

/** Map OAuth paths to rate limit presets */
const OAUTH_RATE_LIMITS: Record<string, RateLimitPreset> = {
  "/api/auth/oauth2/token": "oauth_token",
  "/api/auth/oauth2/authorize": "oauth_authorize",
  "/api/auth/oauth2/register": "oauth_register",
};

/**
 * Check if a request targets an OAuth endpoint and apply rate limiting.
 * Returns a 429 Response if rate limited, or null if allowed.
 */
export async function oauthRateLimitResponse(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  const preset = OAUTH_RATE_LIMITS[url.pathname];
  if (!preset) return null;
  return rateLimitResponse(request, preset);
}
