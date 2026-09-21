import { describe, it, expect } from "vitest";
import { perPlayerShare, perPlayerShareCents, shareFor } from "~/lib/gameCost";

describe("gameCost", () => {
  describe("perPlayerShareCents", () => {
    it("rounds the share to the nearest cent", () => {
      expect(perPlayerShareCents(60, 3)).toBe(2000);
      expect(perPlayerShareCents(10, 3)).toBe(333);
    });

    it("returns 0 when there are no playing slots", () => {
      expect(perPlayerShareCents(10, 0)).toBe(0);
      expect(perPlayerShareCents(10, -1)).toBe(0);
    });

    it("returns 0 for a zero cost", () => {
      expect(perPlayerShareCents(0, 5)).toBe(0);
    });
  });

  describe("perPlayerShare", () => {
    it("returns the share in euros (2dp)", () => {
      expect(perPlayerShare(60, 3)).toBe(20);
      expect(perPlayerShare(10, 3)).toBe(3.33);
    });

    it("returns 0 when there are no playing slots", () => {
      expect(perPlayerShare(10, 0)).toBe(0);
      expect(perPlayerShare(10, -1)).toBe(0);
    });

    it("returns 0 for a zero cost", () => {
      expect(perPlayerShare(0, 5)).toBe(0);
    });
  });

  describe("shareFor", () => {
    it("uses maxPlayers as the denominator", () => {
      expect(shareFor(60, 3)).toBe(20);
      expect(shareFor(50, 3, 10)).toBe(5);
      expect(shareFor(50, 8, 10)).toBe(5);
      expect(shareFor(60, 3, 2)).toBe(30);
    });

    it("returns 0 for an empty roster", () => {
      expect(shareFor(60, 0)).toBe(0);
      expect(shareFor(50, 0, 10)).toBe(0);
    });
  });
});
