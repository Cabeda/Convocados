import { auth } from "./auth.server";
import { authenticateApiKey } from "./apiKey.server";
import { prisma } from "./db.server";

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
      where: { accessToken: token },
    });
    if (oauthToken && oauthToken.userId && oauthToken.accessTokenExpiresAt > new Date()) {
      return {
        userId: oauthToken.userId,
        scopes: oauthToken.scopes.split(" ").filter(Boolean),
        authMethod: "oauth",
        clientId: oauthToken.clientId,
      };
    }
    // Token not found or expired — don't fall through to session
    return null;
  }

  // 3. Session auth (cookie-based)
  try {
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
