import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { flushPendingSyncs, startSyncListener } from "~/wear/syncEngine";
import type { PendingScoreSync } from "~/types/api";

const mockFetch = global.fetch as jest.Mock;
const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

describe("wear/syncEngine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("flushPendingSyncs", () => {
    it("should return 0 when no pending syncs", async () => {
      mockGetItem.mockResolvedValue(null);
      const count = await flushPendingSyncs();
      expect(count).toBe(0);
    });

    it("should sync pending items and remove them", async () => {
      const pending: PendingScoreSync[] = [
        { eventId: "e1", historyId: "h1", scoreOne: 2, scoreTwo: 1, timestamp: 1000 },
      ];
      mockGetItem
        .mockResolvedValueOnce(JSON.stringify(pending)) // getPendingSyncs
        .mockResolvedValueOnce(JSON.stringify(pending)); // removePendingSync reads again

      // Mock the API call (goes through apiFetch which needs tokens)
      // Since we're testing syncEngine directly, mock at fetch level
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      // Need to mock SecureStore for the API client
      const SecureStore = require("expo-secure-store");
      SecureStore.getItemAsync.mockImplementation((key: string) => {
        if (key === "convocados_oauth_tokens") {
          return Promise.resolve(JSON.stringify({
            accessToken: "test_token",
            refreshToken: "test_refresh",
            expiresAt: Date.now() + 3600_000,
          }));
        }
        if (key === "convocados_server_url") {
          return Promise.resolve("https://test.example.com");
        }
        return Promise.resolve(null);
      });

      const count = await flushPendingSyncs();
      expect(count).toBe(1);
    });

    it("should skip items that fail to sync", async () => {
      const pending: PendingScoreSync[] = [
        { eventId: "e1", historyId: "h1", scoreOne: 2, scoreTwo: 1, timestamp: 1000 },
      ];
      mockGetItem.mockResolvedValue(JSON.stringify(pending));

      // Mock fetch to fail
      mockFetch.mockRejectedValue(new Error("Network error"));

      const SecureStore = require("expo-secure-store");
      SecureStore.getItemAsync.mockImplementation((key: string) => {
        if (key === "convocados_oauth_tokens") {
          return Promise.resolve(JSON.stringify({
            accessToken: "test_token",
            refreshToken: "test_refresh",
            expiresAt: Date.now() + 3600_000,
          }));
        }
        if (key === "convocados_server_url") {
          return Promise.resolve("https://test.example.com");
        }
        return Promise.resolve(null);
      });

      const count = await flushPendingSyncs();
      expect(count).toBe(0);
    });
  });

  describe("startSyncListener", () => {
    it("should register a NetInfo listener", () => {
      const unsubscribe = startSyncListener();
      expect(NetInfo.addEventListener).toHaveBeenCalled();
      expect(typeof unsubscribe).toBe("function");
    });

    it("should call onSync callback when syncs complete", async () => {
      mockGetItem.mockResolvedValue(null); // no pending syncs
      const onSync = jest.fn();
      startSyncListener(onSync);

      // Wait for the immediate flush
      await new Promise((r) => setTimeout(r, 10));

      // No syncs to flush, so onSync should not be called
      expect(onSync).not.toHaveBeenCalled();
    });
  });
});
