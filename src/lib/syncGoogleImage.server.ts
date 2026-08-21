import { auth } from "./auth.server";
import { prisma } from "./db.server";
import { decodeIdTokenPayload } from "./googleToken.server";

const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

interface GoogleAccountLike {
  idToken?: string | null;
  accessToken?: string | null;
}

/**
 * Decode the `picture` claim from a Google ID token payload.
 * The token is only read for the picture URL — no signature verification is
 * done here because the token was already verified when it was issued or
 * exchanged by better-auth.
 */
export function pictureFromIdToken(idToken: string): string | null {
  const payload = decodeIdTokenPayload(idToken);
  return typeof payload?.picture === "string" && payload.picture ? payload.picture : null;
}

function isPicture(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Resolve the Google profile picture for a linked account. Tries the stored
 * ID token first (web OAuth flow stores it), then the access token via
 * Google's userinfo endpoint. Returns null when nothing can be resolved.
 */
export async function resolveGooglePicture(google: GoogleAccountLike): Promise<string | null> {
  if (google.idToken) {
    const picture = pictureFromIdToken(google.idToken);
    if (picture) return picture;
  }
  if (google.accessToken) {
    return fetchGoogleUserinfoPicture(google.accessToken);
  }
  return null;
}

async function fetchGoogleUserinfoPicture(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { picture?: unknown };
    return isPicture(data.picture) ? data.picture : null;
  } catch {
    return null;
  }
}

/**
 * Fill in a missing Google profile image for a user after a Google sign-in.
 *
 * No-op when the user already has an image, has no linked Google account, or
 * no picture can be resolved. Only ever fills an empty image — a profile
 * picture the user set (or that was synced before) is never overwritten.
 */
export async function syncGoogleProfileImage(userId: string, idTokenPicture?: string | null): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: true },
  });
  if (!user || user.image) return;

  const google = user.accounts.find((a) => a.providerId === "google");
  if (!google) return;

  const picture = idTokenPicture ?? (await resolveGooglePicture(google));
  if (picture) {
    await prisma.user.update({ where: { id: user.id }, data: { image: picture } });
  }
}

/**
 * Backfill a missing Google profile image after a successful login response.
 * Resolves the session from the response's cookies and fills the image when
 * the session user has none yet.
 */
export async function backfillGoogleProfileImageFromLogin(
  response: Response,
  idTokenPicture: string | null,
): Promise<void> {
  try {
    const cookies = sessionCookiesFromResponse(response);
    if (!cookies) {
      // A successful Google login that set no session cookie leaves no user
      // to update. Log it so a regression (e.g. better-auth changing how it
      // issues cookies) is visible instead of failing silently.
      console.warn("[auth image sync] Google login succeeded without a session cookie; avatar backfill skipped");
      return;
    }
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookies }) });
    if (session?.user?.id && !session.user.image) {
      await syncGoogleProfileImage(session.user.id, idTokenPicture);
    }
  } catch (err) {
    // Backfilling an avatar must never break the sign-in itself.
    console.error("[auth image sync]", err);
  }
}

function sessionCookiesFromResponse(response: Response): string {
  return (response.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}