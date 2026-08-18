import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { verifyGoogleIdToken, resetGoogleJwksCache } from "~/lib/googleToken.server";

const AUDIENCE = "test-client-id";
const ISSUER = "https://accounts.google.com";

// ── Helpers ──────────────────────────────────────────────────────────────

function enc(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: KeyObject): string {
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = createSign("RSA-SHA256").update(data).sign(privateKey, "base64url");
  return `${data}.${sig}`;
}

/** Generate an RSA keypair and the matching public JWK (Google-style). */
function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & { kid: string };
  jwk.kid = "test-kid-1";
  jwk.alg = "RS256";
  jwk.use = "sig";
  return { publicKey, privateKey, jwk };
}

function stubJwks(jwk: JsonWebKey | null): void {
  const body = { keys: jwk ? [jwk] : [] };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
      ),
    ),
  );
}

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "google-sub-123",
    email: "user@example.com",
    email_verified: true,
    name: "Test User",
    picture: "https://example.com/pic.jpg",
    iat: now - 60,
    exp: now + 3600,
    ...overrides,
  };
}

beforeEach(() => {
  resetGoogleJwksCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyGoogleIdToken", () => {
  it("returns the payload for a valid token", async () => {
    const { privateKey, jwk } = makeKeyPair();
    stubJwks(jwk);
    const token = signJwt({ alg: "RS256", kid: "test-kid-1" }, makePayload(), privateKey);

    const payload = await verifyGoogleIdToken(token, [AUDIENCE]);
    expect(payload).not.toBeNull();
    expect(payload!.email).toBe("user@example.com");
    expect(payload!.sub).toBe("google-sub-123");
    expect(payload!.name).toBe("Test User");
  });

  it("returns null when no valid audiences are configured", async () => {
    const { privateKey, jwk } = makeKeyPair();
    stubJwks(jwk);
    const token = signJwt({ alg: "RS256", kid: "test-kid-1" }, makePayload(), privateKey);

    expect(await verifyGoogleIdToken(token, [])).toBeNull();
  });

  it("returns null for a malformed token", async () => {
    expect(await verifyGoogleIdToken("not-a-jwt", [AUDIENCE])).toBeNull();
    expect(await verifyGoogleIdToken("a.b", [AUDIENCE])).toBeNull();
  });

  it("returns null for a non-RS256 token", async () => {
    const { privateKey, jwk } = makeKeyPair();
    stubJwks(jwk);
    const token = signJwt({ alg: "HS256", kid: "test-kid-1" }, makePayload(), privateKey);
    expect(await verifyGoogleIdToken(token, [AUDIENCE])).toBeNull();
  });

  it("returns null when the signature is invalid", async () => {
    const { privateKey, jwk } = makeKeyPair();
    stubJwks(jwk);
    const token = signJwt({ alg: "RS256", kid: "test-kid-1" }, makePayload({ email: "evil@example.com" }), privateKey);
    const [header, , signature] = token.split(".");
    const tamperedPayload = enc(makePayload());
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    expect(await verifyGoogleIdToken(tampered, [AUDIENCE])).toBeNull();
  });

  it("returns null when the issuer is not Google", async () => {
    const { privateKey, jwk } = makeKeyPair();
    stubJwks(jwk);
    const token = signJwt({ alg: "RS256", kid: "test-kid-1" }, makePayload({ iss: "https://evil.example.com" }), privateKey);
    expect(await verifyGoogleIdToken(token, [AUDIENCE])).toBeNull();
  });

  it("returns null when the audience does not match", async () => {
    const { privateKey, jwk } = makeKeyPair();
    stubJwks(jwk);
    const token = signJwt({ alg: "RS256", kid: "test-kid-1" }, makePayload({ aud: "other-client" }), privateKey);
    expect(await verifyGoogleIdToken(token, [AUDIENCE])).toBeNull();
  });

  it("returns null when email is not verified", async () => {
    const { privateKey, jwk } = makeKeyPair();
    stubJwks(jwk);
    const token = signJwt({ alg: "RS256", kid: "test-kid-1" }, makePayload({ email_verified: false }), privateKey);
    expect(await verifyGoogleIdToken(token, [AUDIENCE])).toBeNull();
  });

  it("returns null when the token is expired", async () => {
    const { privateKey, jwk } = makeKeyPair();
    stubJwks(jwk);
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      { alg: "RS256", kid: "test-kid-1" },
      makePayload({ iat: now - 7200, exp: now - 3600 }),
      privateKey,
    );
    expect(await verifyGoogleIdToken(token, [AUDIENCE])).toBeNull();
  });

  it("returns null when the token is issued in the future", async () => {
    const { privateKey, jwk } = makeKeyPair();
    stubJwks(jwk);
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      { alg: "RS256", kid: "test-kid-1" },
      makePayload({ iat: now + 3600, exp: now + 7200 }),
      privateKey,
    );
    expect(await verifyGoogleIdToken(token, [AUDIENCE])).toBeNull();
  });

  it("returns null when the kid is not found in the JWKS", async () => {
    const { privateKey } = makeKeyPair();
    stubJwks(null);
    const token = signJwt({ alg: "RS256", kid: "missing-kid" }, makePayload(), privateKey);
    expect(await verifyGoogleIdToken(token, [AUDIENCE])).toBeNull();
  });

  it("refetches the JWKS when the kid is not in the cached keys", async () => {
    const { privateKey, jwk } = makeKeyPair();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [] }), { status: 200, headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    const token = signJwt({ alg: "RS256", kid: "test-kid-1" }, makePayload(), privateKey);
    const payload = await verifyGoogleIdToken(token, [AUDIENCE]);
    expect(payload).not.toBeNull();
  });

  it("returns null when the JWKS fetch fails", async () => {
    const { privateKey } = makeKeyPair();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    const token = signJwt({ alg: "RS256", kid: "test-kid-1" }, makePayload(), privateKey);
    expect(await verifyGoogleIdToken(token, [AUDIENCE])).toBeNull();
  });
});