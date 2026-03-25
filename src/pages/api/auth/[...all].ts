import type { APIRoute } from "astro";
import { auth } from "../../../lib/auth.server";
import { oauthRateLimitResponse } from "../../../lib/oauthRateLimit.server";

const handler: APIRoute = async ({ request }) => {
  // Apply OAuth-specific rate limits before passing to better-auth
  const limited = await oauthRateLimitResponse(request);
  if (limited) return limited;
  return auth.handler(request);
};

export const GET = handler;
export const POST = handler;
