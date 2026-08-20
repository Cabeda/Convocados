import type { APIRoute } from "astro";
import { auth, ensureTrustedClientInDB } from "../../../lib/auth.server";
import { oauthRateLimitResponse } from "../../../lib/oauthRateLimit.server";
import { verifyGoogleIdToken } from "../../../lib/googleToken.server";
import { backfillGoogleProfileImageFromLogin } from "../../../lib/syncGoogleImage.server";

interface GoogleIdTokenBody {
  provider?: unknown;
  idToken?: { token?: unknown };
}

interface GoogleLoginDetection {
  isGoogleLogin: boolean;
  picture: string | null;
}

const handler: APIRoute = async ({ request }) => {
  // Ensure trusted OAuth client exists in DB (lazy, runs once)
  await ensureTrustedClientInDB();
  // Apply OAuth-specific rate limits before passing to better-auth
  const limited = await oauthRateLimitResponse(request);
  if (limited) return limited;

  // Capture the Google profile picture from an id-token body before the
  // handler consumes it (wear / iOS PWA sign-in).
  const { isGoogleLogin, picture } = await detectGoogleLogin(request);

  let response: Response;
  try {
    response = await auth.handler(request);
  } catch (err: unknown) {
    // better-auth throws Response objects for redirects
    if (err instanceof Response) {
      response = err;
    } else {
      console.error("[auth handler error]", err);
      return Response.json(
        { error: "internal_server_error", error_description: "An unexpected error occurred" },
        { status: 500 },
      );
    }
  }

  // After a successful Google login, backfill a missing profile image.
  // Guarded so an avatar backfill can never break the sign-in itself.
  if (isGoogleLogin && response.status >= 200 && response.status < 400) {
    try {
      await backfillGoogleProfileImageFromLogin(response, picture);
    } catch (err) {
      console.error("[auth image sync]", err);
    }
  }

  return response;
};

/**
 * Detect a Google login request and extract its profile picture.
 * Covers the web OAuth callback (/callback/google) and the id-token sign-in
 * path (/sign-in/social with provider "google").
 */
async function detectGoogleLogin(request: Request): Promise<GoogleLoginDetection> {
  const pathname = new URL(request.url).pathname;

  if (pathname.endsWith("/callback/google")) {
    return { isGoogleLogin: true, picture: null };
  }
  if (!pathname.endsWith("/sign-in/social") || request.method !== "POST") {
    return { isGoogleLogin: false, picture: null };
  }

  let body: GoogleIdTokenBody;
  try {
    body = await request.clone().json();
  } catch {
    return { isGoogleLogin: false, picture: null };
  }
  if (body.provider !== "google") return { isGoogleLogin: false, picture: null };
  if (typeof body.idToken?.token !== "string") return { isGoogleLogin: true, picture: null };

  const validAudiences = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
  ].filter(Boolean) as string[];

  const payload = await verifyGoogleIdToken(body.idToken.token, validAudiences);
  return { isGoogleLogin: true, picture: payload?.picture ?? null };
}

export const GET = handler;
export const POST = handler;