import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import type { KeyObject } from "node:crypto";

/**
 * E2E regression test for Google social sign-in through the REAL better-auth
 * handler (no mocks on the auth layer).
 *
 * Guards against better-auth upgrades silently breaking login — e.g. v1.7
 * began keying social accounts on `(issuer, accountId)`, which crashed every
 * Google callback until `Account.issuer` was added and backfilled.
 *
 * Google's token + JWKS endpoints are stubbed with a locally-signed ID token
 * so the full round-trip runs offline:
 *   POST /api/auth/sign-in/social        → authorization URL + state cookies
 *   GET  /api/auth/callback/google       → code exchange → session + DB rows
 */

const CLIENT_ID = "e2e-google-client-id.apps.googleusercontent.com";
const GOOGLE_ISSUER = "https://accounts.google.com";

let privateKey: KeyObject;
let jwk: JsonWebKey & { kid: string };

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET ??= "test-google-secret";
  process.env.BETTER_AUTH_URL ??= "http://localhost:4321";
  process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-0123456789";

  const kp = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = kp.privateKey;
  jwk = kp.publicKey.export({ format: "jwk" }) as JsonWebKey & { kid: string };
  jwk.kid = "e2e-kid-1";
  jwk.alg = "RS256";
  jwk.use = "sig";
});

function enc(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function signIdToken(sub: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: jwk.kid, typ: "JWT" };
  const payload = {
    iss: GOOGLE_ISSUER,
    aud: CLIENT_ID,
    sub,
    email,
    email_verified: true,
    name: "E2E Google User",
    picture: "https://example.com/e2e-pic.jpg",
    iat: now - 60,
    exp: now + 3600,
  };
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = createSign("RSA-SHA256").update(data).sign(privateKey, "base64url");
  return `${data}.${sig}`;
}

/** Intercept only Google endpoints; everything else passes through untouched. */
function stubGoogleEndpoints(idToken: string): void {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(
        JSON.stringify({
          access_token: "ya29.e2e-access-token",
          id_token: idToken,
          expires_in: 3599,
          scope: "openid email profile",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input as any, init);
  }) as typeof fetch;
}

async function loadAuth() {
  const mod = await import("~/lib/auth.server");
  return mod.auth;
}
async function loadDb() {
  const mod = await import("~/lib/db.server");
  return mod.prisma;
}
type Auth = Awaited<ReturnType<typeof loadAuth>>;
type Db = Awaited<ReturnType<typeof loadDb>>;

describe("Google social sign-in (real auth.handler e2e)", () => {
  let auth: Auth;
  let prisma: Db;

  beforeAll(async () => {
    auth = await loadAuth();
    prisma = await loadDb();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "google-e2e-" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Step 1 of the browser flow: returns auth URL + state cookies. */
  async function initiateSignIn(): Promise<{ url: URL; cookies: string }> {
    const res = await auth.handler(
      new Request("http://localhost:4321/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const url = new URL(body.url);
    expect(url.host).toBe("accounts.google.com");
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    expect(cookies).toContain("better-auth.state=");
    return { url, cookies };
  }

  it("completes the web round-trip: creates user + account and issues a session", async () => {
    const sub = `e2e-sub-${Date.now()}`;
    const email = `google-e2e-${Date.now()}@example.com`;
    stubGoogleEndpoints(signIdToken(sub, email));

    const init = await initiateSignIn();

    const cb = await auth.handler(
      new Request(`http://localhost:4321/api/auth/callback/google?code=e2e-code&state=${init.url.searchParams.get("state")}`, {
        method: "GET",
        headers: { cookie: init.cookies },
      }),
    );

    expect(cb.status).toBe(302);
    // Redirects to the requested callbackURL, not the auth error page.
    expect(cb.headers.get("location")).toBe("/");
    const setCookies = cb.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((c) => c.startsWith("better-auth.session_token="))).toBe(true);

    const user = await prisma.user.findUnique({ where: { email }, include: { accounts: true } });
    expect(user).not.toBeNull();
    const account = user!.accounts.find((a) => a.providerId === "google");
    expect(account).not.toBeNull();
    // 1.7 keys accounts by issuer — must be persisted for future lookups.
    expect(account!.issuer).toBe(GOOGLE_ISSUER);
    expect(account!.accountId).toBe(sub);

    await prisma.user.delete({ where: { id: user!.id } });
  });

  it("re-links a returning legacy account instead of failing or duplicating", async () => {
    const sub = `e2e-legacy-sub-${Date.now()}`;
    const email = `google-e2e-legacy-${Date.now()}@example.com`;
    stubGoogleEndpoints(signIdToken(sub, email));

    const first = await initiateSignIn();
    const cb1 = await auth.handler(
      new Request(`http://localhost:4321/api/auth/callback/google?code=e2e-code&state=${first.url.searchParams.get("state")}`, {
        method: "GET",
        headers: { cookie: first.cookies },
      }),
    );
    expect(cb1.status).toBe(302);
    const user1 = await prisma.user.findUniqueOrThrow({ where: { email }, include: { accounts: true } });
    expect(user1.accounts).toHaveLength(1);

    // Second sign-in exercises the (issuer, accountId) lookup path — the exact
    // query that broke every login under better-auth 1.7 without the column.
    const second = await initiateSignIn();
    const cb2 = await auth.handler(
      new Request(`http://localhost:4321/api/auth/callback/google?code=e2e-code&state=${second.url.searchParams.get("state")}`, {
        method: "GET",
        headers: { cookie: second.cookies },
      }),
    );
    expect(cb2.status).toBe(302);
    expect(cb2.headers.get("location")).toBe("/");

    const users = await prisma.user.findMany({ where: { email }, include: { accounts: true } });
    expect(users).toHaveLength(1);
    expect(users[0].accounts).toHaveLength(1);

    await prisma.user.delete({ where: { id: user1.id } });
  });

  it("supports mobile/wear id-token sign-in via POST /sign-in/social", async () => {
    const sub = `e2e-idtoken-sub-${Date.now()}`;
    const email = `google-e2e-idtoken-${Date.now()}@example.com`;
    stubGoogleEndpoints(signIdToken(sub, email));

    const res = await auth.handler(
      new Request("http://localhost:4321/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: "/",
          idToken: { token: signIdToken(sub, email) },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((c) => c.startsWith("better-auth.session_token="))).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { accounts: true } });
    const account = user.accounts.find((a) => a.providerId === "google");
    expect(account).not.toBeNull();
    expect(account!.issuer).toBe(GOOGLE_ISSUER);

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("rejects an ID token signed by an unknown key", async () => {
    const sub = `e2e-badkey-sub-${Date.now()}`;
    const email = `google-e2e-badkey-${Date.now()}@example.com`;

    // JWKS serves a DIFFERENT key than the one that signed the token.
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const otherJwk = other.publicKey.export({ format: "jwk" }) as JsonWebKey & { kid: string };
    otherJwk.kid = "e2e-kid-1";
    otherJwk.alg = "RS256";
    otherJwk.use = "sig";
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://www.googleapis.com/oauth2/v3/certs") {
        return new Response(JSON.stringify({ keys: [otherJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input as any, init);
    }) as typeof fetch;

    const res = await auth.handler(
      new Request("http://localhost:4321/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", idToken: { token: signIdToken(sub, email) } }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });
});
