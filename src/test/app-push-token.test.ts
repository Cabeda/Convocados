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
    const req = makeRequest("POST", { token: "ExponentPushToken[xxx]", platform: "ios" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(401);
  });

  it("should return 400 when token is missing", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    const req = makeRequest("POST", { platform: "ios" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Token is required");
  });

  it("should return 400 for invalid platform", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    const req = makeRequest("POST", { token: "ExponentPushToken[xxx]", platform: "windows" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Platform must be");
  });

  it("should upsert token on success", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockUpsert.mockResolvedValue({});
    const req = makeRequest("POST", { token: "ExponentPushToken[xxx]", platform: "android" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { token: "ExponentPushToken[xxx]" },
      create: { userId: "u1", token: "ExponentPushToken[xxx]", platform: "android", locale: "en" },
      update: expect.objectContaining({ userId: "u1", platform: "android", locale: "en" }),
    });
  });

  it("should store locale when provided", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockUpsert.mockResolvedValue({});
    const req = makeRequest("POST", { token: "ExponentPushToken[yyy]", platform: "ios", locale: "pt" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { token: "ExponentPushToken[yyy]" },
      create: { userId: "u1", token: "ExponentPushToken[yyy]", platform: "ios", locale: "pt" },
      update: expect.objectContaining({ userId: "u1", platform: "ios", locale: "pt" }),
    });
  });

  it("should default locale to 'en' when not provided", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockUpsert.mockResolvedValue({});
    const req = makeRequest("POST", { token: "ExponentPushToken[zzz]", platform: "android" });
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
    const req = makeRequest("POST", { token: "ExponentPushToken[trunc]", platform: "android", locale: "en-US-extra-long" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ locale: "en-US-extr" }),
      }),
    );
  });

  it("should accept raw FCM tokens (not just Expo format)", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth" });
    mockUpsert.mockResolvedValue({});
    const fcmToken = "dGVzdC1mY20tdG9rZW4:APA91bTestToken";
    const req = makeRequest("POST", { token: fcmToken, platform: "android" });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: fcmToken },
        create: expect.objectContaining({ token: fcmToken, platform: "android" }),
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
    const req = makeRequest("DELETE", { token: "ExponentPushToken[xxx]" });
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
    const req = makeRequest("DELETE", { token: "ExponentPushToken[xxx]" });
    const res = await DELETE({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { token: "ExponentPushToken[xxx]", userId: "u1" },
    });
  });
});
