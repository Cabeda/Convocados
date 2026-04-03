import { apiFetch, apiGet, apiPost, apiPatch, apiDelete, ApiError } from "~/api/client";
import * as SecureStore from "expo-secure-store";
import type { OAuthTokens } from "~/types/api";

const mockFetch = global.fetch as jest.Mock;

// Helper to set up valid tokens in SecureStore
function mockValidTokens() {
  const tokens: OAuthTokens = {
    accessToken: "valid_token",
    refreshToken: "refresh_token",
    expiresAt: Date.now() + 3600_000,
  };
  (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => {
    if (key === "convocados_oauth_tokens") return Promise.resolve(JSON.stringify(tokens));
    if (key === "convocados_server_url") return Promise.resolve("https://test.example.com");
    return Promise.resolve(null);
  });
}

describe("api/client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidTokens();
  });

  describe("apiFetch", () => {
    it("should add Authorization header", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await apiFetch("/api/me/games");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://test.example.com/api/me/games");
      expect(init.headers.get("Authorization")).toBe("Bearer valid_token");
    });

    it("should retry on 401 with refreshed token", async () => {
      // First call returns 401, second returns 200
      mockFetch
        .mockResolvedValueOnce(new Response("", { status: 401 }))
        .mockResolvedValueOnce(
          // Mock the token refresh endpoint
          new Response(JSON.stringify({
            access_token: "new_token",
            refresh_token: "new_refresh",
            expires_in: 3600,
          }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      // Also mock the OIDC discovery for refresh
      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes(".well-known/openid-configuration")) {
          return new Response(JSON.stringify({
            authorization_endpoint: "https://test.example.com/api/auth/authorize",
            token_endpoint: "https://test.example.com/api/auth/token",
            userinfo_endpoint: "https://test.example.com/api/auth/userinfo",
          }), { status: 200 });
        }
        if (url.includes("/api/auth/token")) {
          return new Response(JSON.stringify({
            access_token: "new_token",
            refresh_token: "new_refresh",
            expires_in: 3600,
          }), { status: 200 });
        }
        if (init?.headers) {
          const headers = new Headers(init.headers);
          if (headers.get("Authorization") === "Bearer valid_token") {
            return new Response("", { status: 401 });
          }
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const res = await apiFetch("/api/me/games");
      expect(res.status).toBe(200);
    });
  });

  describe("apiGet", () => {
    it("should parse JSON response", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ data: "test" }), { status: 200 }),
      );

      const result = await apiGet<{ data: string }>("/api/test");
      expect(result).toEqual({ data: "test" });
    });

    it("should throw ApiError on non-200", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
      );

      await expect(apiGet("/api/test")).rejects.toThrow(ApiError);
    });

    it("should include error message from response", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
      );

      await expect(apiGet("/api/test")).rejects.toThrow("Not found");
    });
  });

  describe("apiPost", () => {
    it("should send JSON body", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      await apiPost("/api/test", { name: "test" });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ name: "test" }));
    });
  });

  describe("apiPatch", () => {
    it("should send PATCH with JSON body", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      await apiPatch("/api/test", { score: 1 });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe("PATCH");
    });
  });

  describe("apiDelete", () => {
    it("should handle 204 No Content", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

      const result = await apiDelete("/api/test");
      expect(result).toEqual({ ok: true });
    });

    it("should parse JSON on non-204", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true, undo: {} }), { status: 200 }),
      );

      const result = await apiDelete("/api/test", { id: "123" });
      expect(result).toEqual({ ok: true, undo: {} });
    });
  });

  describe("ApiError", () => {
    it("should have status and message", () => {
      const err = new ApiError(404, "Not found");
      expect(err.status).toBe(404);
      expect(err.message).toBe("Not found");
      expect(err.name).toBe("ApiError");
    });
  });
});
