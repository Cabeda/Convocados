import * as SecureStore from "expo-secure-store";
import { getTokens, setTokens, clearTokens, isTokenExpired, getServerUrl, setServerUrl } from "~/auth/storage";
import type { OAuthTokens } from "~/types/api";

describe("auth/storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getTokens", () => {
    it("should return null when no tokens stored", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      const result = await getTokens();
      expect(result).toBeNull();
    });

    it("should return parsed tokens when stored", async () => {
      const tokens: OAuthTokens = {
        accessToken: "at_123",
        refreshToken: "rt_456",
        expiresAt: Date.now() + 3600_000,
      };
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(tokens));
      const result = await getTokens();
      expect(result).toEqual(tokens);
    });

    it("should return null for invalid JSON", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("not-json");
      const result = await getTokens();
      expect(result).toBeNull();
    });
  });

  describe("setTokens", () => {
    it("should store tokens as JSON", async () => {
      const tokens: OAuthTokens = {
        accessToken: "at_123",
        refreshToken: "rt_456",
        expiresAt: Date.now() + 3600_000,
      };
      await setTokens(tokens);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        "convocados_oauth_tokens",
        JSON.stringify(tokens),
      );
    });
  });

  describe("clearTokens", () => {
    it("should delete the token key", async () => {
      await clearTokens();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("convocados_oauth_tokens");
    });
  });

  describe("isTokenExpired", () => {
    it("should return false for tokens expiring in the future", () => {
      const tokens: OAuthTokens = {
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: Date.now() + 120_000, // 2 min from now
      };
      expect(isTokenExpired(tokens)).toBe(false);
    });

    it("should return true for tokens expiring within 60s", () => {
      const tokens: OAuthTokens = {
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: Date.now() + 30_000, // 30s from now (within 60s buffer)
      };
      expect(isTokenExpired(tokens)).toBe(true);
    });

    it("should return true for already expired tokens", () => {
      const tokens: OAuthTokens = {
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: Date.now() - 1000,
      };
      expect(isTokenExpired(tokens)).toBe(true);
    });
  });

  describe("server URL", () => {
    it("should return default URL when none stored", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      const url = await getServerUrl();
      expect(url).toBe("http://localhost:4321");
    });

    it("should return stored URL", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("https://my-instance.com");
      const url = await getServerUrl();
      expect(url).toBe("https://my-instance.com");
    });

    it("should store server URL", async () => {
      await setServerUrl("https://custom.example.com");
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        "convocados_server_url",
        "https://custom.example.com",
      );
    });
  });
});
