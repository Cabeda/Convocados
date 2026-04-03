import type { APIRoute } from "astro";
import { auth, ensureTrustedClientInDB } from "../../../lib/auth.server";
import { oauthRateLimitResponse } from "../../../lib/oauthRateLimit.server";

const handler: APIRoute = async ({ request }) => {
  // Ensure trusted OAuth client exists in DB (lazy, runs once)
  await ensureTrustedClientInDB();
  // Apply OAuth-specific rate limits before passing to better-auth
  const limited = await oauthRateLimitResponse(request);
  if (limited) return limited;
  try {
    return await auth.handler(request);
  } catch (err: unknown) {
    // better-auth throws Response objects for redirects
    if (err instanceof Response) return err;
    console.error("[auth handler error]", err);
    return Response.json(
      { error: "internal_server_error", error_description: "An unexpected error occurred" },
      { status: 500 },
    );
  }
};

export const GET = handler;
export const POST = handler;
