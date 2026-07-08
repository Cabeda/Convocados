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
});

describe("POST /api/auth/mobile-native — email-signup", () => {
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
});
