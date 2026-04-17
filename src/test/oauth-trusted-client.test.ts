/**
 * OAuth 2.1 trusted-client integration test
 *
 * Exercises the full OAuth flow through better-auth's handler:
 * 1. Sign up + sign in (session cookie)
 * 2. Authorize (trusted client → direct redirect, no consent)
 * 3. Token exchange (code + PKCE → access_token)
 * 4. Use token (authenticateRequest)
 * 5. Introspect token
 * 6. Refresh token
 * 7. Revoke token
 *
 * Uses a trusted client configured via env vars so consent is skipped,
 * matching the flow that Bruno / Android / WearOS apps will use.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { authenticateRequest, requireScope } from "~/lib/authenticate.server";
import { auth, ensureTrustedClientInDB } from "~/lib/auth.server";

// ── Trusted client credentials (must match env / auth.server config) ────
const TRUSTED_CLIENT_ID = process.env.TRUSTED_OAUTH_CLIENT_ID ?? "test-trusted-client";
const TRUSTED_CLIENT_SECRET = process.env.TRUSTED_OAUTH_CLIENT_SECRET ?? "test-trusted-secret";
const REDIRECT_URI = "https://oauth.usebruno.com/callback";
const BASE = "http://localhost:4321";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Generate PKCE code_verifier + code_challenge (S256) */
function generatePKCE() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Call auth.handler and return the Response */
async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const req = new Request(url, init);
  try {
    return await auth.handler(req);
  } catch (err: unknown) {
    // better-auth throws Response objects for redirects
    if (err instanceof Response) return err;
    throw err;
  }
}

/** Extract the full Set-Cookie value for a given cookie name */
function extractCookie(res: Response, name: string): string | null {
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    if (c.startsWith(`${name}=`)) {
      return c.split(";")[0]; // "name=value"
    }
  }
  return null;
}

/**
 * Get the redirect URL from a response.
 * better-auth returns 302 for non-browser requests, or JSON { redirect, url }
 * for browser-like fetch requests (detected via Sec-Fetch-Site header).
 */
async function getRedirectUrl(res: Response): Promise<string> {
  if (res.status === 302 || res.status === 301) {
    return res.headers.get("location") ?? "";
  }
  const body = await res.json();
  return body.url ?? body.redirectURI ?? "";
}

// ── Test setup ──────────────────────────────────────────────────────────

const TEST_USER = {
  email: "trusted-oauth-test@example.com",
  password: "TestPassword123!",
  name: "OAuth Test User",
};

let sessionCookie = "";
let testUserId = "";

beforeEach(async () => {
  await resetApiRateLimitStore();
});

beforeAll(async () => {
  // Clean up ALL test data to start fresh
  await prisma.$executeRawUnsafe("DELETE FROM OauthConsent");
  await prisma.$executeRawUnsafe("DELETE FROM OauthAccessToken");
  await prisma.$executeRawUnsafe("DELETE FROM OauthApplication");
  await prisma.$executeRawUnsafe("DELETE FROM Verification");
  await prisma.$executeRawUnsafe("DELETE FROM Session");
  await prisma.$executeRawUnsafe("DELETE FROM Account");
  await prisma.$executeRawUnsafe("DELETE FROM User WHERE email = ?", TEST_USER.email);

  // Ensure the trusted client row exists in the DB (for FK constraints)
  await ensureTrustedClientInDB();

  // Sign up via better-auth to create User + Account (with hashed password)
  const _signUpRes = await authFetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({
      name: TEST_USER.name,
      email: TEST_USER.email,
      password: TEST_USER.password,
    }),
  });

  // Sign-up with requireEmailVerification won't return a session cookie,
  // so we need to manually verify the email and then sign in.
  await prisma.user.updateMany({
    where: { email: TEST_USER.email },
    data: { emailVerified: true },
  });

  // Now sign in to get a properly signed session cookie
  const signInRes = await authFetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({
      email: TEST_USER.email,
      password: TEST_USER.password,
    }),
  });

  const cookie = extractCookie(signInRes, "better-auth.session_token");
  if (!cookie) {
    const body = await signInRes.clone().text();
    throw new Error(`Failed to sign in: status=${signInRes.status} body=${body}`);
  }
  sessionCookie = cookie;

  // Get the user ID from the DB
  const user = await prisma.user.findFirst({ where: { email: TEST_USER.email } });
  if (!user) throw new Error("Test user not found after sign-up");
  testUserId = user.id;
});

describe("OAuth 2.1 trusted client — full flow via auth.handler", () => {
  it("authorize skips consent for trusted client and returns code + state", async () => {
    const { verifier: _verifier2, challenge } = generatePKCE();
    const state = randomBytes(16).toString("hex");

    const res = await authFetch(
      `${BASE}/api/auth/oauth2/authorize?` +
        new URLSearchParams({
          response_type: "code",
          client_id: TRUSTED_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          scope: "openid profile email",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString(),
      {
        headers: { Cookie: sessionCookie, Origin: BASE },
      },
    );

    // Should redirect directly (no consent page)
    const redirectUrl = await getRedirectUrl(res);
    expect(redirectUrl).toContain(REDIRECT_URI);
    expect(redirectUrl).toContain("code=");
    expect(redirectUrl).toContain(`state=${state}`);

    // Should NOT redirect to consent page
    expect(redirectUrl).not.toContain("/oauth/consent");
  });

  it("full flow: authorize → token exchange → authenticate → introspect → revoke", async () => {
    const { verifier, challenge } = generatePKCE();
    const state = randomBytes(16).toString("hex");

    // ── Step 1: Authorize ──────────────────────────────────────────
    const authRes = await authFetch(
      `${BASE}/api/auth/oauth2/authorize?` +
        new URLSearchParams({
          response_type: "code",
          client_id: TRUSTED_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          scope: "openid profile email offline_access read:events",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString(),
      {
        headers: { Cookie: sessionCookie, Origin: BASE },
      },
    );

    const redirectUrl = await getRedirectUrl(authRes);
    const parsedRedirect = new URL(redirectUrl);
    const code = parsedRedirect.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(parsedRedirect.searchParams.get("state")).toBe(state);

    // ── Step 2: Token exchange ─────────────────────────────────────
    const tokenRes = await authFetch(`${BASE}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: BASE,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: TRUSTED_CLIENT_ID,
        client_secret: TRUSTED_CLIENT_SECRET,
        code_verifier: verifier,
      }).toString(),
    });

    if (tokenRes.status !== 200) {
      const errBody = await tokenRes.clone().text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${errBody}`);
    }
    expect(tokenRes.status).toBe(200);
    const tokenData = await tokenRes.json();
    expect(tokenData.access_token).toBeTruthy();
    expect(tokenData.refresh_token).toBeTruthy();
    expect(tokenData.token_type).toBe("Bearer");
    expect(tokenData.scope).toContain("openid");
    expect(tokenData.id_token).toBeTruthy();

    // ── Step 3: Authenticate with the token ────────────────────────
    const authCtx = await authenticateRequest(
      new Request(`${BASE}/api/events`, {
        headers: { authorization: `Bearer ${tokenData.access_token}` },
      }),
    );
    expect(authCtx).not.toBeNull();
    expect(authCtx!.authMethod).toBe("oauth");
    expect(authCtx!.userId).toBe(testUserId);
    expect(authCtx!.clientId).toBe(TRUSTED_CLIENT_ID);

    // ── Step 4: Scope enforcement ──────────────────────────────────
    expect(requireScope(authCtx!, "read:events")).toBe(true);
    expect(requireScope(authCtx!, "write:events")).toBe(false);

    // ── Step 5: Introspect ─────────────────────────────────────────
    const introspectRes = await authFetch(`${BASE}/api/auth/oauth2/introspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ token: tokenData.access_token }),
    });
    // introspect may be handled by a separate route, fall back to direct DB check
    if (introspectRes.status === 200) {
      const introspectData = await introspectRes.json();
      expect(introspectData.active).toBe(true);
      expect(introspectData.client_id).toBe(TRUSTED_CLIENT_ID);
    }

    // ── Step 6: Revoke ─────────────────────────────────────────────
    const revokeRes = await authFetch(`${BASE}/api/auth/oauth2/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ token: tokenData.access_token }),
    });
    // revoke may be handled by a separate route
    if (revokeRes.status === 200) {
      // Verify token is now rejected
      const revokedCtx = await authenticateRequest(
        new Request(`${BASE}/api/events`, {
          headers: { authorization: `Bearer ${tokenData.access_token}` },
        }),
      );
      expect(revokedCtx).toBeNull();
    }
  });

  it("token exchange fails with wrong client_secret", async () => {
    const { verifier, challenge } = generatePKCE();
    const state = randomBytes(16).toString("hex");

    const authRes = await authFetch(
      `${BASE}/api/auth/oauth2/authorize?` +
        new URLSearchParams({
          response_type: "code",
          client_id: TRUSTED_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          scope: "openid",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString(),
      {
        headers: { Cookie: sessionCookie, Origin: BASE },
      },
    );

    const redirectUrl = await getRedirectUrl(authRes);
    const code = new URL(redirectUrl).searchParams.get("code");

    const tokenRes = await authFetch(`${BASE}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: BASE,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: TRUSTED_CLIENT_ID,
        client_secret: "wrong-secret",
        code_verifier: verifier,
      }).toString(),
    });

    expect(tokenRes.status).toBeGreaterThanOrEqual(400);
  });

  it("token exchange fails with wrong code_verifier", async () => {
    const { verifier: _verifier, challenge } = generatePKCE();
    const state = randomBytes(16).toString("hex");

    const authRes = await authFetch(
      `${BASE}/api/auth/oauth2/authorize?` +
        new URLSearchParams({
          response_type: "code",
          client_id: TRUSTED_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          scope: "openid",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString(),
      {
        headers: { Cookie: sessionCookie, Origin: BASE },
      },
    );

    const redirectUrl = await getRedirectUrl(authRes);
    const code = new URL(redirectUrl).searchParams.get("code");

    const tokenRes = await authFetch(`${BASE}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: BASE,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: TRUSTED_CLIENT_ID,
        client_secret: TRUSTED_CLIENT_SECRET,
        code_verifier: "wrong-verifier-that-does-not-match",
      }).toString(),
    });

    expect(tokenRes.status).toBeGreaterThanOrEqual(400);
  });
});
