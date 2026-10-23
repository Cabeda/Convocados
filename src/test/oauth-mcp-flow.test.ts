/**
 * The MCP connector flow, end to end, over HTTP (#1486 follow-up).
 *
 * Claude.ai's connector registers itself (DCR), sends the user to our sign-in
 * page, and expects a code back. Every step of that chain lives in a
 * different place, and each one has broken on its own:
 *
 *   1. POST /oauth2/register            — the client registers itself
 *   2. GET  /oauth2/authorize (no session) → 302 /auth/signin?<signed query>
 *   3. the user signs in; the browser must return to the authorization
 *      endpoint with that same signed query
 *   4. GET  /oauth2/authorize (session)  → 302 /oauth/consent?<signed query>
 *   5. POST /oauth2/consent {accept, oauth_query} → {redirect, url} with a code
 *   6. POST /oauth2/token               → access token
 *   7. POST /api/mcp with the token     → the tool runs as the signed-in user
 *
 * Steps 2-4 are the ones that silently ended the flow: the sign-in page threw
 * the authorization request away, and the consent page posted a body the AS
 * could not read.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { auth } from "~/lib/auth.server";
import { oauthAuthorizeResumePath } from "~/lib/oauthAuthorizeResume";
import { POST as registerHandler } from "~/pages/api/auth/oauth2/register";
import { POST as mcpHandler } from "~/pages/api/mcp";

const BASE = "http://localhost:4321";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const TEST_USER = {
  email: "mcp-flow-test@example.com",
  password: "TestPassword123!",
  name: "MCP Flow Test User",
};

function generatePKCE() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** better-auth throws Response objects for redirects; capture them. */
async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await auth.handler(new Request(url, init));
  } catch (err: unknown) {
    if (err instanceof Response) return err;
    throw err;
  }
}

function extractCookie(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    if (c.startsWith(`${name}=`)) return c.split(";")[0];
  }
  return null;
}

/** The URL a redirect points at, whether it came back as a 302 or as JSON. */
async function redirectUrl(res: Response): Promise<string> {
  if (res.status === 302 || res.status === 301) return res.headers.get("location") ?? "";
  const body: any = await res.json().catch(() => ({}));
  return body.url ?? body.redirect_uri ?? body.redirectURI ?? "";
}

let sessionCookie = "";
let testUserId = "";

beforeEach(async () => {
  await resetApiRateLimitStore();
});

beforeAll(async () => {
  await prisma.$executeRawUnsafe("DELETE FROM oauthConsent");
  await prisma.$executeRawUnsafe("DELETE FROM oauthAccessToken");
  await prisma.$executeRawUnsafe("DELETE FROM oauthRefreshToken");
  await prisma.$executeRawUnsafe("DELETE FROM oauthClient");
  await prisma.$executeRawUnsafe("DELETE FROM Verification");
  await prisma.$executeRawUnsafe("DELETE FROM Session");
  await prisma.$executeRawUnsafe("DELETE FROM Account");
  await prisma.$executeRawUnsafe("DELETE FROM User WHERE email = ?", TEST_USER.email);

  await authFetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ name: TEST_USER.name, email: TEST_USER.email, password: TEST_USER.password }),
  });
  await prisma.user.updateMany({ where: { email: TEST_USER.email }, data: { emailVerified: true } });

  const signInRes = await authFetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
  });
  const cookie = extractCookie(signInRes, "better-auth.session_token");
  if (!cookie) {
    throw new Error(`Failed to sign in: status=${signInRes.status} body=${await signInRes.clone().text()}`);
  }
  sessionCookie = cookie;

  const user = await prisma.user.findFirst({ where: { email: TEST_USER.email } });
  if (!user) throw new Error("Test user not found after sign-up");
  testUserId = user.id;
});

/** Register a public client the way an MCP connector backend does. */
async function registerClient(scope: string) {
  const res = await registerHandler({
    request: new Request(`${BASE}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope,
      }),
    }),
  } as any);
  expect(res.status).toBe(201);
  const body: any = await res.json();
  return body.client_id as string;
}

describe("oauthAuthorizeResumePath — only a signed OAuth request is resumed", () => {
  const SIGNED =
    "response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&scope=openid&sig=deadbeef";

  it("returns the authorization endpoint with the request intact", () => {
    expect(oauthAuthorizeResumePath(`?${SIGNED}`)).toBe(`/api/auth/oauth2/authorize?${SIGNED}`);
    expect(oauthAuthorizeResumePath(SIGNED)).toBe(`/api/auth/oauth2/authorize?${SIGNED}`);
  });

  it("ignores anything that is not a signed authorization request", () => {
    expect(oauthAuthorizeResumePath("")).toBeNull();
    expect(oauthAuthorizeResumePath("?callbackURL=/dashboard")).toBeNull();
    // No signature — not something the AS issued.
    expect(oauthAuthorizeResumePath(SIGNED.replace("&sig=deadbeef", ""))).toBeNull();
    // Not an authorization request.
    expect(oauthAuthorizeResumePath("?response_type=code&client_id=abc&sig=x")).toBeNull();
  });
});

describe("MCP connector flow — register, sign in, consent, token, tool call", () => {
  it("completes the OAuth flow and runs an MCP tool as the signed-in user", async () => {
    const clientId = await registerClient("openid profile email read:events create:events");
    const { verifier, challenge } = generatePKCE();
    const state = randomBytes(8).toString("hex");

    // ── Step 2: no session → the sign-in page, carrying the request ──────
    // `resource` is what an MCP client sends per RFC 8707. Without a matching
    // oauthResource row the authorization server rejects the request with
    // invalid_target *before* consent, which looks exactly like a broken
    // connector: registration succeeds, no consent or token is ever stored.
    const authorizeUrl =
      `${BASE}/api/auth/oauth2/authorize?` +
      new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: "openid profile email read:events create:events",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: `${BASE}/api/mcp`,
      }).toString();

    const anonymous = await authFetch(authorizeUrl, { headers: { Origin: BASE } });
    const loginUrl = await redirectUrl(anonymous);
    expect(loginUrl).toContain("/auth/signin?");

    // The sign-in page must be able to hand the request back (step 3).
    const loginSearch = new URL(loginUrl, BASE).search;
    const resumePath = oauthAuthorizeResumePath(loginSearch);
    expect(resumePath).toBeTruthy();
    expect(resumePath).toContain("client_id=" + clientId);

    // ── Step 3+4: signed in → the consent page ───────────────────────────
    const authorized = await authFetch(`${BASE}${resumePath}`, {
      headers: { Cookie: sessionCookie, Origin: BASE },
    });
    const consentUrl = await redirectUrl(authorized);
    expect(consentUrl).toContain("/oauth/consent?");

    // ── Step 5: consent ──────────────────────────────────────────────────
    const consentSearch = new URL(consentUrl, BASE).search.replace(/^\?/, "");
    const consentRes = await authFetch(`${BASE}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie, Origin: BASE },
      body: JSON.stringify({ accept: true, oauth_query: consentSearch }),
    });
    expect(consentRes.status).toBe(200);
    const consentBody: any = await consentRes.json();
    const codeRedirect = consentBody.url ?? consentBody.redirect_uri;
    expect(codeRedirect).toBeTruthy();

    const code = new URL(codeRedirect).searchParams.get("code");
    expect(code).toBeTruthy();
    expect(new URL(codeRedirect).searchParams.get("state")).toBe(state);
    // RFC 9207 `iss` must be the issuer the client read from the metadata, or
    // Claude refuses the connector as an unconfirmed identity.
    expect(new URL(codeRedirect).searchParams.get("iss")).toBe(BASE);

    // Consent is remembered for this user and client.
    const consent = await prisma.oauthConsent.findFirst({ where: { clientId, userId: testUserId } });
    expect(consent).not.toBeNull();

    // ── Step 6: token exchange ──────────────────────────────────────────
    const tokenRes = await authFetch(`${BASE}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
        resource: `${BASE}/api/mcp`,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const token: any = await tokenRes.json();
    expect(token.access_token).toBeTruthy();
    expect(token.scope).toContain("read:events");
    // A resource-scoped token is a JWT, not an `oauthAccessToken` row — the
    // MCP handler verifies it against the JWKS, so a tampered token must fail.
    expect(String(token.access_token).split(".")).toHaveLength(3);
    expect(await prisma.oauthAccessToken.count({ where: { clientId } })).toBe(0);

    // ── Step 7: the tool runs as the user who signed in ──────────────────
    const mcpRes = await mcpHandler({
      request: new Request(`${BASE}/api/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token.access_token}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "convocados_list_my_games", arguments: {} },
        }),
      }),
    } as any);
    expect(mcpRes.status).toBe(200);
    const mcpBody: any = await mcpRes.json();
    expect(mcpBody.error).toBeUndefined();
    const games = JSON.parse(mcpBody.result.content[0].text);
    expect(games.owned).toEqual([]);
    expect(games.admin).toEqual([]);

    // Scope escalation by editing the payload must not pass: the signature
    // covers the claims, so the tampered token is rejected outright.
    const [head, body, sig] = String(token.access_token).split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    claims.scope = claims.scope.replace("read:events", "manage:payments");
    const forged = `${head}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${sig}`;
    const forgedRes = await mcpHandler({
      request: new Request(`${BASE}/api/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${forged}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "convocados_list_my_games", arguments: {} },
        }),
      }),
    } as any);
    expect(forgedRes.status).toBe(401);
  });

  it("accepts the MCP endpoint as a resource and refuses an unregistered one", async () => {
    const clientId = await registerClient("openid read:events");
    const { challenge } = generatePKCE();
    const authorize = (resource: string) =>
      authFetch(
        `${BASE}/api/auth/oauth2/authorize?` +
          new URLSearchParams({
            response_type: "code",
            client_id: clientId,
            redirect_uri: REDIRECT_URI,
            scope: "openid read:events",
            state: randomBytes(4).toString("hex"),
            code_challenge: challenge,
            code_challenge_method: "S256",
            resource,
          }).toString(),
        { headers: { Origin: BASE } },
      );

    // The endpoint Claude names must be a known resource, or the flow dies
    // with `invalid_target` before the user ever sees a consent screen.
    const ok = await authorize(`${BASE}/api/mcp`);
    expect(await redirectUrl(ok)).toContain("/auth/signin?");

    const unknown = await authorize(`${BASE}/api/not-ours`);
    expect(await redirectUrl(unknown)).toContain("error=invalid_target");
  });
});
