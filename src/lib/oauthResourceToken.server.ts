import { createPublicKey, verify as verifySignature } from "node:crypto";
import { prisma } from "./db.server";
import { parseStoredScopes } from "./scopes";

/**
 * Verify an OAuth access token that this authorization server minted as a JWT.
 *
 * Registering the MCP endpoint as an RFC 8707 resource (see `resources` in
 * `auth.server.ts`) switches access tokens from opaque database rows to
 * audience-bound JWTs — `tokenEndpoint` only issues an opaque token when there
 * is no audience claim. `authenticateRequest` resolves opaque tokens from
 * `oauthAccessToken`, so without this path every MCP call with a resource-scoped
 * token failed with 401.
 *
 * Keys come from the `jwks` table the `jwt()` plugin writes; EdDSA (Ed25519) is
 * what that plugin signs with, and node:crypto verifies it natively.
 */

/** Claims the MCP handler needs, once the signature and audience check out. */
export interface ResourceTokenClaims {
  userId: string;
  scopes: string[];
  clientId?: string;
}

const BASE = (process.env.BETTER_AUTH_URL ?? "http://localhost:4321").replace(/\/$/, "");
// The issuer the `jwt` plugin signs with, and the one our AS metadata publishes
// (`/.well-known/oauth-authorization-server`). Claude checks these match.
const ISSUER = BASE;
const AUDIENCE = `${BASE}/api/mcp`;

const KEY_TTL_MS = 5 * 60 * 1000;
let keyCache: { loadedAt: number; keys: Map<string, JsonWebKey> } | null = null;

/** Public signing keys, keyed by `kid`. Cached: the plugin rotates rarely. */
async function publicKeys(): Promise<Map<string, JsonWebKey>> {
  if (keyCache && Date.now() - keyCache.loadedAt < KEY_TTL_MS) return keyCache.keys;
  const rows = await prisma.jwks.findMany({ select: { id: true, publicKey: true } });
  const keys = new Map<string, JsonWebKey>();
  for (const row of rows) {
    try {
      keys.set(row.id, JSON.parse(row.publicKey) as JsonWebKey);
    } catch {
      // Unparseable row — skip it rather than fail every request.
    }
  }
  keyCache = { loadedAt: Date.now(), keys };
  return keys;
}

/** Test hook: drop the cached keys after a JWKS change. */
export function resetResourceTokenKeyCache(): void {
  keyCache = null;
}

function decodeSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Returns the claims of a valid, unexpired token issued for the MCP endpoint,
 * or null when the token is opaque, malformed, expired, or not ours.
 */
export async function verifyResourceAccessToken(
  token: string,
): Promise<ResourceTokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const header = decodeSegment<{ alg?: string; kid?: string }>(parts[0]);
  const payload = decodeSegment<{
    sub?: string;
    aud?: string | string[];
    scope?: string;
    client_id?: string;
    iss?: string;
    exp?: number;
  }>(parts[1]);
  if (!header || !payload) return null;
  // Only EdDSA is signed by this issuer; anything else is not our token.
  if (header.alg !== "EdDSA") return null;
  if (payload.iss !== ISSUER) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(AUDIENCE)) return null;
  if (!payload.sub) return null;

  const keys = await publicKeys();
  const keyed = header.kid ? keys.get(header.kid) : undefined;
  const candidates = keyed ? [keyed] : [...keys.values()];

  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  const valid = candidates.some((jwk) => {
    try {
      return verifySignature(null, signed, createPublicKey({ key: jwk, format: "jwk" }), signature);
    } catch {
      return false;
    }
  });
  if (!valid) return null;

  return {
    userId: payload.sub,
    scopes: parseStoredScopes(payload.scope),
    clientId: payload.client_id,
  };
}
