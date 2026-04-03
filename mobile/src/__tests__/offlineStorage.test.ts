import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getPendingSyncs,
  savePendingSync,
  removePendingSync,
  clearAllPendingSyncs,
} from "~/wear/offlineStorage";
import type { PendingScoreSync } from "~/types/api";

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;

describe("wear/offlineStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getPendingSyncs", () => {
    it("should return empty array when nothing stored", async () => {
      mockGetItem.mockResolvedValue(null);
      const result = await getPendingSyncs();
      expect(result).toEqual([]);
    });

    it("should return parsed syncs", async () => {
      const syncs: PendingScoreSync[] = [
        { eventId: "e1", historyId: "h1", scoreOne: 2, scoreTwo: 1, timestamp: 1000 },
      ];
      mockGetItem.mockResolvedValue(JSON.stringify(syncs));
      const result = await getPendingSyncs();
      expect(result).toEqual(syncs);
    });

    it("should return empty array for invalid JSON", async () => {
      mockGetItem.mockResolvedValue("invalid");
      const result = await getPendingSyncs();
      expect(result).toEqual([]);
    });
  });

  describe("savePendingSync", () => {
    it("should add a new sync", async () => {
      mockGetItem.mockResolvedValue(null);
      const sync: PendingScoreSync = {
        eventId: "e1",
        historyId: "h1",
        scoreOne: 3,
        scoreTwo: 2,
        timestamp: Date.now(),
      };

      await savePendingSync(sync);

      expect(mockSetItem).toHaveBeenCalledWith(
        "convocados_pending_syncs",
        JSON.stringify([sync]),
      );
    });

    it("should upsert by historyId", async () => {
      const existing: PendingScoreSync[] = [
        { eventId: "e1", historyId: "h1", scoreOne: 1, scoreTwo: 0, timestamp: 1000 },
      ];
      mockGetItem.mockResolvedValue(JSON.stringify(existing));

      const updated: PendingScoreSync = {
        eventId: "e1",
        historyId: "h1",
        scoreOne: 2,
        scoreTwo: 1,
        timestamp: 2000,
      };

      await savePendingSync(updated);

      expect(mockSetItem).toHaveBeenCalledWith(
        "convocados_pending_syncs",
        JSON.stringify([updated]),
      );
    });

    it("should append when historyId is different", async () => {
      const existing: PendingScoreSync[] = [
        { eventId: "e1", historyId: "h1", scoreOne: 1, scoreTwo: 0, timestamp: 1000 },
      ];
      mockGetItem.mockResolvedValue(JSON.stringify(existing));

      const newSync: PendingScoreSync = {
        eventId: "e2",
        historyId: "h2",
        scoreOne: 0,
        scoreTwo: 1,
        timestamp: 2000,
      };

      await savePendingSync(newSync);

      expect(mockSetItem).toHaveBeenCalledWith(
        "convocados_pending_syncs",
        JSON.stringify([existing[0], newSync]),
      );
    });
  });

  describe("removePendingSync", () => {
    it("should remove sync by historyId", async () => {
      const existing: PendingScoreSync[] = [
        { eventId: "e1", historyId: "h1", scoreOne: 1, scoreTwo: 0, timestamp: 1000 },
        { eventId: "e2", historyId: "h2", scoreOne: 2, scoreTwo: 1, timestamp: 2000 },
      ];
      mockGetItem.mockResolvedValue(JSON.stringify(existing));

      await removePendingSync("h1");

      expect(mockSetItem).toHaveBeenCalledWith(
        "convocados_pending_syncs",
        JSON.stringify([existing[1]]),
      );
    });
  });

  describe("clearAllPendingSyncs", () => {
    it("should remove the storage key", async () => {
      await clearAllPendingSyncs();
      expect(mockRemoveItem).toHaveBeenCalledWith("convocados_pending_syncs");
    });
  });
});
