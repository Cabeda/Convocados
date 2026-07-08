import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

// Mock better-auth handler — controls email/password sign-in/sign-up behavior
const mockAuthHandler = vi.fn();
vi.mock("~/lib/auth.server", () => ({
  auth: { handler: (...args: any[]) => mockAuthHandler(...args) },
  ensureTrustedClientInDB: vi.fn(),
}));

// Import the handler
import { POST } from "~/pages/api/auth/mobile-native";

function ctx(body: unknown) {
  const request = new Request("http://localhost/api/auth/mobile-native", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: {} } as any;
}

beforeEach(async () => {
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthRefreshToken.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  // Ensure the mobile OAuth client exists (issueTokens references it)
  await prisma.oauthClient.upsert({
    where: { clientId: "convocados-mobile-app" },
    create: { id: "convocados-mobile-app", clientId: "convocados-mobile-app", clientSecret: "", name: "Mobile", type: "native", redirectUris: "convocados://auth", public: true },
    update: {},
  });
  vi.restoreAllMocks();
});

describe("POST /api/auth/mobile-native — action dispatch", () => {
  it("returns 400 for missing action", async () => {
    const res = await POST(ctx({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid action");
  });

  it("returns 400 for unknown action", async () => {
    const res = await POST(ctx({ action: "nope" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/mobile-native — email-signin", () => {
  it("returns 400 when email or password missing", async () => {
    const res = await POST(ctx({ action: "email-signin", email: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("required");
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(ctx({ action: "email-signin", email: "a@b.com", password: "" }));
    expect(res.status).toBe(400);
  });

  it("returns tokens on successful sign-in", async () => {
    // Create the user that the sign-in will look up
    await prisma.user.create({
      data: { id: "u1", email: "test@example.com", name: "Tester", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    });

    // Mock better-auth accepting the credentials
    mockAuthHandler.mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 }));

    const res = await POST(ctx({ action: "email-signin", email: "test@example.com", password: "pass123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBeDefined();
    expect(body.refresh_token).toBeDefined();
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(3600);
  });

  it("forwards better-auth error on invalid credentials", async () => {
    mockAuthHandler.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }),
    );

    const res = await POST(ctx({ action: "email-signin", email: "bad@example.com", password: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when user not found after successful auth", async () => {
    // better-auth succeeds but user doesn't exist in our DB (edge case)
    mockAuthHandler.mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "ghost" } }), { status: 200 }));

    const res = await POST(ctx({ action: "email-signin", email: "ghost@example.com", password: "pass" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("User not found");
  });
});

describe("POST /api/auth/mobile-native — email-signup", () => {
  it("returns 400 when email is missing", async () => {
    const res = await POST(ctx({ action: "email-signup", email: "", password: "pass", name: "Test" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Email and password are required");
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(ctx({ action: "email-signup", email: "a@b.com", password: "", name: "Test" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(ctx({ action: "email-signup", email: "a@b.com", password: "pass" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Name is required");
  });

  it("returns 201 with verification message on successful signup", async () => {
    // Mock better-auth creating the account
    mockAuthHandler.mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "new" } }), { status: 200 }));

    const res = await POST(ctx({ action: "email-signup", name: "New User", email: "new@example.com", password: "pass123" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.requires_verification).toBe(true);
  });

  it("forwards better-auth error (duplicate email)", async () => {
    mockAuthHandler.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Email already exists" }), { status: 400 }),
    );

    const res = await POST(ctx({ action: "email-signup", name: "Dup", email: "dup@example.com", password: "pass" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/mobile-native — google-id-token", () => {
  it("returns 400 when idToken is missing", async () => {
    const res = await POST(ctx({ action: "google-id-token" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("idToken is required");
  });

  it("returns 401 for invalid token (mocked fetch)", async () => {
    // Mock the Google tokeninfo fetch to return 400
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 400 })) as any;

    const res = await POST(ctx({ action: "google-id-token", idToken: "bad-token" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Invalid or expired");

    globalThis.fetch = originalFetch;
  });

  it("returns 401 when audience does not match", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ aud: "wrong-client-id", email: "a@b.com", email_verified: true, sub: "123" }), { status: 200 }),
    ) as any;

    const res = await POST(ctx({ action: "google-id-token", idToken: "valid-format" }));
    expect(res.status).toBe(401);

    globalThis.fetch = originalFetch;
  });

  it("returns 401 when email is not verified", async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ aud: "test-client-id", email: "a@b.com", email_verified: "false", sub: "123" }), { status: 200 }),
    ) as any;

    const res = await POST(ctx({ action: "google-id-token", idToken: "valid-format" }));
    expect(res.status).toBe(401);

    globalThis.fetch = originalFetch;
    process.env.GOOGLE_CLIENT_ID = originalEnv;
  });

  it("creates new user and returns tokens for valid Google token", async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({
        aud: "test-client-id",
        email: "google@example.com",
        email_verified: true,
        sub: "google-sub-123",
        name: "Google User",
        picture: "https://example.com/photo.jpg",
      }), { status: 200 }),
    ) as any;

    const res = await POST(ctx({ action: "google-id-token", idToken: "valid-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBeDefined();
    expect(body.refresh_token).toBeDefined();
    expect(body.token_type).toBe("Bearer");

    // Verify user was created
    const user = await prisma.user.findUnique({ where: { email: "google@example.com" } });
    expect(user).not.toBeNull();
    expect(user!.name).toBe("Google User");
    expect(user!.image).toBe("https://example.com/photo.jpg");

    // Verify account link was created
    const account = await prisma.account.findFirst({ where: { userId: user!.id, providerId: "google" } });
    expect(account).not.toBeNull();
    expect(account!.accountId).toBe("google-sub-123");

    globalThis.fetch = originalFetch;
    process.env.GOOGLE_CLIENT_ID = originalEnv;
  });

  it("links Google account to existing user found by email", async () => {
    // Pre-create user without Google account
    await prisma.user.create({
      data: { id: "existing-u", email: "existing@example.com", name: "Existing", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    });

    const originalFetch = globalThis.fetch;
    const originalEnv = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({
        aud: "test-client-id",
        email: "existing@example.com",
        email_verified: true,
        sub: "google-sub-456",
        name: "Existing User",
        picture: "https://example.com/new-pic.jpg",
      }), { status: 200 }),
    ) as any;

    const res = await POST(ctx({ action: "google-id-token", idToken: "valid-token" }));
    expect(res.status).toBe(200);

    // Verify account link was created for existing user
    const account = await prisma.account.findFirst({ where: { userId: "existing-u", providerId: "google" } });
    expect(account).not.toBeNull();
    expect(account!.accountId).toBe("google-sub-456");

    // Verify profile picture was updated
    const user = await prisma.user.findUnique({ where: { id: "existing-u" } });
    expect(user!.image).toBe("https://example.com/new-pic.jpg");

    globalThis.fetch = originalFetch;
    process.env.GOOGLE_CLIENT_ID = originalEnv;
  });

  it("skips account link if already exists", async () => {
    await prisma.user.create({
      data: { id: "linked-u", email: "linked@example.com", name: "Linked", image: "https://example.com/pic.jpg", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    });
    await prisma.account.create({
      data: { id: "acc-1", userId: "linked-u", accountId: "google-sub-789", providerId: "google", createdAt: new Date(), updatedAt: new Date() },
    });

    const originalFetch = globalThis.fetch;
    const originalEnv = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({
        aud: "test-client-id",
        email: "linked@example.com",
        email_verified: true,
        sub: "google-sub-789",
        picture: "https://example.com/pic.jpg", // same picture, no update
      }), { status: 200 }),
    ) as any;

    const res = await POST(ctx({ action: "google-id-token", idToken: "valid-token" }));
    expect(res.status).toBe(200);

    // Should still only have one account link
    const accounts = await prisma.account.findMany({ where: { userId: "linked-u", providerId: "google" } });
    expect(accounts).toHaveLength(1);

    globalThis.fetch = originalFetch;
    process.env.GOOGLE_CLIENT_ID = originalEnv;
  });
});

describe("POST /api/auth/mobile-native — magic-link", () => {
  it("returns 400 when email is missing", async () => {
    const res = await POST(ctx({ action: "magic-link", email: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Email is required");
  });

  it("returns success when better-auth accepts the request", async () => {
    mockAuthHandler.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await POST(ctx({ action: "magic-link", email: "user@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("Magic link sent");
  });

  it("returns 400 when better-auth rejects the request", async () => {
    mockAuthHandler.mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }));

    const res = await POST(ctx({ action: "magic-link", email: "user@example.com" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Could not send magic link");
  });
});

describe("POST /api/auth/mobile-native — error handling", () => {
  it("returns 500 on unexpected error", async () => {
    // Send invalid JSON to trigger a parse error
    const request = new Request("http://localhost/api/auth/mobile-native", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST({ request, params: {} } as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
  });
});
