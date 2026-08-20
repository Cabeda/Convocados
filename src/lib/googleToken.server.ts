/**
 * Google ID token verification.
 *
 * Replaces the deprecated `oauth2.googleapis.com/tokeninfo` call with proper
 * JWT validation: RS256 signature verified against Google's published JWKS,
 * plus issuer / audience / expiry / email-verified claim checks.
 *
 * All functions return `null` (never throw) on any verification failure so
 * callers can treat the token as unverified without extra branching.
 */
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
/** Allow a small clock-skew window when checking `iat`. */
const CLOCK_SKEW_SECONDS = 300;
const JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface GoogleIdTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  exp?: number;
  iat?: number;
}

/** Verified claims — `sub` and `email` are guaranteed present. */
export type VerifiedGoogleIdToken = GoogleIdTokenClaims & { sub: string; email: string };

/** Google JWKS entry. `@types/node` JsonWebKey lacks `kid`/`alg`/`use`. */
interface GoogleJwk extends JsonWebKey {
  kid: string;
  alg?: string;
  use?: string;
}

let jwksCache: { keys: GoogleJwk[]; expiresAt: number } | null = null;

function base64UrlToBuffer(input: string): ArrayBuffer {
  const bytes = Buffer.from(input, "base64url");
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function decodeToken(
  token: string,
): { header: { alg?: string; kid?: string }; payload: GoogleIdTokenClaims; data: string; signature: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string; kid?: string };
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as GoogleIdTokenClaims;
    return { header, payload, data: `${h}.${p}`, signature: s };
  } catch {
    return null;
  }
}

/**
 * Decode a Google ID token's payload without verifying it.
 * Only for reading claims out of a token that was already verified by
 * better-auth (or by {@link verifyGoogleIdToken}) before being persisted.
 */
export function decodeIdTokenPayload(token: string): GoogleIdTokenClaims | null {
  return decodeToken(token)?.payload ?? null;
}

async function fetchJwks(): Promise<GoogleJwk[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) return jwksCache.keys;

  const res = await fetch(GOOGLE_JWKS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) return [];
  const data = (await res.json()) as { keys?: GoogleJwk[] };
  jwksCache = { keys: data.keys ?? [], expiresAt: now + JWKS_CACHE_TTL_MS };
  return jwksCache.keys;
}

/**
 * Verify a Google ID token and return its claims.
 *
 * Returns `null` if the token is malformed, signed by an unknown key, has an
 * invalid signature, or fails any claim check (issuer, audience, email
 * verification, expiry, issuance-in-the-future).
 */
export async function verifyGoogleIdToken(
  idToken: string,
  validAudiences: string[],
): Promise<VerifiedGoogleIdToken | null> {
  if (!validAudiences.length) return null;

  const decoded = decodeToken(idToken);
  if (!decoded) return null;
  const { header, payload, data, signature } = decoded;

  if (header.alg !== "RS256" || !header.kid) return null;

  // Find the signing key, refetching once if the kid isn't cached (Google
  // rotates keys and our cache may have gone stale).
  let jwk = (await fetchJwks()).find((k) => k.kid === header.kid);
  if (!jwk) {
    jwksCache = null;
    jwk = (await fetchJwks()).find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;

  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }

  const signatureValid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    publicKey,
    base64UrlToBuffer(signature),
    new TextEncoder().encode(data),
  );
  if (!signatureValid) return null;

  // ── Claim validation ──────────────────────────────────────────────────
  if (!GOOGLE_ISSUERS.has(payload.iss ?? "")) return null;
  if (!validAudiences.includes(payload.aud ?? "")) return null;
  if (payload.email_verified !== true && payload.email_verified !== "true") return null;
  if (typeof payload.exp !== "number" || Date.now() / 1000 >= payload.exp) return null;
  if (typeof payload.iat === "number" && Date.now() / 1000 + CLOCK_SKEW_SECONDS < payload.iat) return null;
  if (!payload.sub || !payload.email) return null;

  return payload as VerifiedGoogleIdToken;
}

/** Clear the cached JWKS. Exposed for tests. */
export function resetGoogleJwksCache(): void {
  jwksCache = null;
}