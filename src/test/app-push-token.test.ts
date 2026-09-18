/**
 * Tests for POST/DELETE /api/push/app-token
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock prisma
const mockUpsert = vi.fn();
const mockDeleteMany = vi.fn();
const mockFindUnique = vi.fn();
vi.mock("~/lib/db.server", () => ({
  prisma: {
    appPushToken: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

// Mock rate limiter
vi.mock("~/lib/apiRateLimit.server", () => ({
  rateLimitResponse: vi.fn().mockResolvedValue(null),
}));

// Mock authenticate
const mockAuthenticateRequest = vi.fn();
vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

// Import the handlers after mocks
const { POST, DELETE } = await import("~/pages/api/push/app-token");

function makeRequest(method: string, body: Record<string, unknown>): Request {
  return new Request("http://localhost:4321/api/push/app-token", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/push/app-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(null);
  });

  it("should return 401 when not authenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const req = makeRequest("POST", { token: "fcm-token-xxx", platform: "android" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(401);
  });

  it("should return 400 when token is missing", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    const req = makeRequest("POST", { platform: "android" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Token is required");
  });

  it("should return 400 for invalid platform", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    const req = makeRequest("POST", { token: "fcm-token-xxx", platform: "windows" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Platform must be");
  });

  it("should upsert token on success", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockUpsert.mockResolvedValue({});
    const req = makeRequest("POST", { token: "fcm-token-xxx", platform: "android" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { token: "fcm-token-xxx" },
      create: { userId: "u1", token: "fcm-token-xxx", platform: "android", locale: "en" },
      update: expect.objectContaining({ platform: "android", locale: "en" }),
    });
    // userId must never be reassigned on an existing token.
    expect((mockUpsert.mock.calls[0][0] as any).update).not.toHaveProperty("userId");
  });

  it("should store locale when provided", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockUpsert.mockResolvedValue({});
    const req = makeRequest("POST", { token: "fcm-token-yyy", platform: "android", locale: "pt" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { token: "fcm-token-yyy" },
      create: { userId: "u1", token: "fcm-token-yyy", platform: "android", locale: "pt" },
      update: expect.objectContaining({ platform: "android", locale: "pt" }),
    });
    expect((mockUpsert.mock.calls[0][0] as any).update).not.toHaveProperty("userId");
  });

  it("should default locale to 'en' when not provided", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockUpsert.mockResolvedValue({});
    const req = makeRequest("POST", { token: "fcm-token-zzz", platform: "android" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ locale: "en" }),
        update: expect.objectContaining({ locale: "en" }),
      }),
    );
  });

  it("should return 409 and not upsert when the token belongs to another account", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockFindUnique.mockResolvedValue({ userId: "someone-else", token: "fcm-token-taken" });
    const req = makeRequest("POST", { token: "fcm-token-taken", platform: "android" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(409);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("should allow re-registering a token already owned by the caller", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockFindUnique.mockResolvedValue({ userId: "u1", token: "fcm-token-mine" });
    mockUpsert.mockResolvedValue({});
    const req = makeRequest("POST", { token: "fcm-token-mine", platform: "ios", locale: "pt" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(200);
  });

  it("should truncate locale to 10 chars", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockUpsert.mockResolvedValue({});
    const req = makeRequest("POST", { token: "fcm-token-trunc", platform: "android", locale: "en-US-extra-long" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ locale: "en-US-extr" }),
      }),
    );
  });
});

describe("DELETE /api/push/app-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const req = makeRequest("DELETE", { token: "fcm-token-xxx" });
    const res = await DELETE({ request: req } as any);
    expect(res.status).toBe(401);
  });

  it("should return 400 when token is missing", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    const req = makeRequest("DELETE", {});
    const res = await DELETE({ request: req } as any);
    expect(res.status).toBe(400);
  });

  it("should delete token on success", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockDeleteMany.mockResolvedValue({ count: 1 });
    const req = makeRequest("DELETE", { token: "fcm-token-xxx" });
    const res = await DELETE({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { token: "fcm-token-xxx", userId: "u1" },
    });
  });
});
