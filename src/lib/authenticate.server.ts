import { createHash } from "node:crypto";
import { auth, ensureAuthKeysHealthy } from "./auth.server";
import { authenticateApiKey } from "./apiKey.server";
import { prisma } from "./db.server";
import { logger } from "./logger.server";
import { parseStoredScopes } from "./scopes";
import { verifyResourceAccessToken } from "./oauthResourceToken.server";

/**
 * Claim summary of a bearer token that failed both the opaque-row lookup and
 * the JWT verification. Diagnostics only — never includes the token.
 */
export function describeRejectedBearer(token: string): Record<string, unknown> {
  const parts = token.split(".");
  const decode = (segment?: string): Record<string, any> | null => {
    if (!segment) return null;
    try {
      return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  };
  const header = decode(parts[0]);
  const payload = decode(parts[1]);
  return {
    segments: parts.length,
    alg: header?.alg,
    kid: header?.kid,
    iss: payload?.iss,
    aud: payload?.aud,
    exp: payload?.exp,
    scope: payload?.scope,
    hasSub: Boolean(payload?.sub),
    clientId: payload?.client_id,
  };
}

/** Hash a token the same way better-auth stores them (SHA-256 → base64url) */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export type AuthMethod = "session" | "api_key" | "oauth";

export interface AuthContext {
  userId: string;
  scopes: string[];
  authMethod: AuthMethod;
  /** API key ID (only for api_key auth) */
  keyId?: string;
  /** OAuth client ID (only for oauth auth) */
  clientId?: string;
}

/**
 * Unified request authentication.
 *
 * Checks in order:
 * 1. API key (`Bearer cvk_...`)
 * 2. OAuth bearer token (`Bearer ...` that is not an API key)
 * 3. Session auth (cookie-based via better-auth)
 *
 * Returns null if no valid auth is found.
 */
export async function authenticateRequest(
  request: Request,
): Promise<AuthContext | null> {
  const authHeader = request.headers.get("authorization");

  // 1. API key auth
  if (authHeader?.startsWith("Bearer cvk_")) {
    const result = await authenticateApiKey(request);
    if (!result) return null;
    return {
      userId: result.userId,
      scopes: result.scopes,
      authMethod: "api_key",
      keyId: result.keyId,
    };
  }

  // 2. OAuth bearer token
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    // Bypass for local development/testing
    if (process.env.NODE_ENV !== "production" && token === "local_test_token") {
      return {
        userId: "demo-organizer-001",
        scopes: ["*"],
        authMethod: "oauth",
        clientId: "local-dev-client",
      };
    }

    const oauthToken = await prisma.oauthAccessToken.findUnique({
      where: { token: hashToken(token) },
    }) ?? await prisma.oauthAccessToken.findUnique({
      where: { token },
    });
    if (oauthToken && oauthToken.userId && (!oauthToken.expiresAt || oauthToken.expiresAt > new Date())) {
      return {
        userId: oauthToken.userId,
        scopes: parseStoredScopes(oauthToken.scopes),
        authMethod: "oauth",
        clientId: oauthToken.clientId,
      };
    }
    // A resource-scoped token is a JWT with no database row (see the module doc).
    const claims = await verifyResourceAccessToken(token);
    if (claims) {
      return {
        userId: claims.userId,
        scopes: claims.scopes,
        authMethod: "oauth",
        clientId: claims.clientId,
      };
    }
    // Token not found or expired — don't fall through to session.
    // Logged because a connector that mints tokens but then fails every MCP
    // call is otherwise invisible: Fly keeps no request log, and the claim
    // values below are what tell a wrong issuer from a wrong audience or a
    // stale signature. Never log the token itself.
    logger.warn(describeRejectedBearer(token), "oauth bearer rejected");
    return null;
  }

  // 3. Session auth (cookie-based)
  try {
    await ensureAuthKeysHealthy();
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user) {
      return {
        userId: session.user.id,
        scopes: ["*"], // session auth has full access
        authMethod: "session",
      };
    }
  } catch {
    // Session lookup failed — not authenticated
  }

  return null;
}

/**
 * Check if an auth context has a required scope.
 * Session auth (`*`) always passes.
 */
export function requireScope(ctx: AuthContext, scope: string): boolean {
  if (ctx.scopes.includes("*")) return true;
  return ctx.scopes.includes(scope);
}
