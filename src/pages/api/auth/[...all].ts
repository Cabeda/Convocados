import type { APIRoute } from "astro";
import { auth, ensureTrustedClientInDB, ensureAuthKeysHealthy } from "../../../lib/auth.server";
import { oauthRateLimitResponse } from "../../../lib/oauthRateLimit.server";
import { verifyGoogleIdToken } from "../../../lib/googleToken.server";
import { backfillGoogleProfileImageFromLogin } from "../../../lib/syncGoogleImage.server";
import { installMergeCapture, captureDuring } from "../../../lib/mergeCapture.server";
import { prisma } from "../../../lib/db.server";

interface GoogleIdTokenBody {
  provider?: unknown;
  idToken?: { token?: unknown };
}

interface GoogleLoginDetection {
  isGoogleLogin: boolean;
  picture: string | null;
}

/**
 * If this is an OAuth callback carrying a `state` whose payload includes
 * `link.userId` (account-linking flow), return that survivor id so
 * findAccountByKey conflicts can be captured as a pending merge (ADR 0040).
 */
async function readLinkSurvivorId(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) return null;
  try {
    const row = await prisma.verification.findFirst({ where: { identifier: state } });
    if (!row?.value) return null;
    const data = JSON.parse(row.value) as { link?: { userId?: string } };
    return data.link?.userId ?? null;
  } catch {
    return null;
  }
}

const handler: APIRoute = async ({ request }) => {
  // Ensure trusted OAuth client exists in DB (lazy, runs once)
  await ensureTrustedClientInDB();
  // Self-heal JWKS keys left over from a rotated auth secret (lazy, runs once)
  await ensureAuthKeysHealthy();
  // Wrap internalAdapter.findAccountByKey so link conflicts become pending merges
  await installMergeCapture(auth);
  // Apply OAuth-specific rate limits before passing to better-auth
  const limited = await oauthRateLimitResponse(request);
  if (limited) return limited;

  // Capture the Google profile picture from an id-token body before the
  // handler consumes it (wear / iOS PWA sign-in).
  const { isGoogleLogin, picture } = await detectGoogleLogin(request);

  // Link-flow callbacks: scope merge capture to this request's survivor.
  const linkSurvivorId = await readLinkSurvivorId(request);

  let response: Response;
  try {
    const run = () => auth.handler(request);
    response = linkSurvivorId ? await captureDuring(linkSurvivorId, run) : await run();
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