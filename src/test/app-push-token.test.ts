/**
 * Tests for POST/DELETE /api/push/app-token
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock prisma
const mockUpsert = vi.fn();
const mockDeleteMany = vi.fn();
vi.mock("~/lib/db.server", () => ({
  prisma: {
    appPushToken: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
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
      update: expect.objectContaining({ userId: "u1", platform: "android", locale: "en" }),
    });
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
      update: expect.objectContaining({ userId: "u1", platform: "android", locale: "pt" }),
    });
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
