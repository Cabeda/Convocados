import { prisma } from "./db.server";

const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

interface GoogleAccountLike {
  idToken?: string | null;
  accessToken?: string | null;
}

/**
 * Decode the `picture` claim from a Google ID token (base64url JWT payload).
 * The token is only read for the picture URL — no signature verification is
 * done here because the token was already verified when it was issued or
 * exchanged by better-auth.
 */
export function pictureFromIdToken(idToken: string): string | null {
  try {
    const payloadPart = idToken.split(".")[1];
    if (!payloadPart) return null;
    const json = Buffer.from(payloadPart, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { picture?: unknown };
    return typeof payload.picture === "string" && payload.picture ? payload.picture : null;
  } catch {
    return null;
  }
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
    try {
      const res = await fetch(GOOGLE_USERINFO_URL, {
        headers: { authorization: `Bearer ${google.accessToken}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { picture?: unknown };
        if (typeof data.picture === "string" && data.picture) return data.picture;
      }
    } catch {
      // Network failure — leave the image untouched.
    }
  }
  return null;
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