import type { APIRoute } from "astro";
import { auth, ensureTrustedClientInDB } from "../../../lib/auth.server";
import { oauthRateLimitResponse } from "../../../lib/oauthRateLimit.server";
import { verifyGoogleIdToken } from "../../../lib/googleToken.server";
import { syncGoogleProfileImage } from "../../../lib/syncGoogleImage.server";

const handler: APIRoute = async ({ request }) => {
  // Ensure trusted OAuth client exists in DB (lazy, runs once)
  await ensureTrustedClientInDB();
  // Apply OAuth-specific rate limits before passing to better-auth
  const limited = await oauthRateLimitResponse(request);
  if (limited) return limited;

  // Detect a Google login on this request and capture the profile picture
  // from an id-token body before the handler consumes it (wear / iOS PWA).
  const { active: isGoogleLogin, picture: idTokenPicture } = await detectGoogleLogin(request);

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
  if (isGoogleLogin && response.status >= 200 && response.status < 400) {
    await syncProfileImageFromLogin(response, idTokenPicture);
  }

  return response;
};

/**
 * Detect a Google login request and extract its profile picture.
 * Covers the web OAuth callback (GET /callback/google) and the id-token
 * sign-in path (POST /sign-in/social with provider "google").
 */
async function detectGoogleLogin(request: Request): Promise<{ active: boolean; picture: string | null }> {
  const pathname = new URL(request.url).pathname;

  if (pathname.endsWith("/callback/google")) {
    return { active: true, picture: null };
  }
  if (!pathname.endsWith("/sign-in/social") || request.method !== "POST") {
    return { active: false, picture: null };
  }

  let body: { provider?: unknown; idToken?: { token?: unknown } };
  try {
    body = await request.clone().json();
  } catch {
    return { active: false, picture: null };
  }
  if (body?.provider !== "google") return { active: false, picture: null };
  if (typeof body.idToken?.token !== "string") return { active: true, picture: null };

  const validAudiences = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
  ].filter(Boolean) as string[];

  const payload = await verifyGoogleIdToken(body.idToken.token, validAudiences);
  return { active: true, picture: payload?.picture ?? null };
}

/** Resolve the session from the login response and backfill a missing image. */
async function syncProfileImageFromLogin(response: Response, idTokenPicture: string | null): Promise<void> {
  try {
    const cookies = (response.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
    if (!cookies) return;
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookies }) });
    if (session?.user?.id) {
      await syncGoogleProfileImage(session.user.id, idTokenPicture);
    }
  } catch (err) {
    // Backfilling an avatar must never break the sign-in itself.
    console.error("[auth image sync]", err);
  }
}

export const GET = handler;
export const POST = handler;
