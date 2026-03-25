import { describe, it, expect } from "vitest";
import { formatWhatsAppMessage, getWhatsAppUrl, type WhatsAppMessageData } from "~/lib/whatsapp";
import en from "~/lib/i18n/en";

describe("WhatsApp utilities", () => {
  const mockT = (key: string, params?: Record<string, string | number>) => {
    let value = (en as Record<string, string>)[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(`{${k}}`, String(v));
      }
    }
    return value;
  };

  describe("formatWhatsAppMessage", () => {
    it("formats a complete message with all fields", () => {
      const data: WhatsAppMessageData = {
        title: "Tuesday 5-a-side",
        date: new Date("2024-01-15T18:00:00"),
        location: "Campo do Restelo",
        spotsLeft: 3,
        maxPlayers: 10,
        eventUrl: "https://example.com/events/abc123",
      };

      const message = formatWhatsAppMessage(data, mockT);

      expect(message).toContain("Tuesday 5-a-side");
      expect(message).toContain("Campo do Restelo");
      expect(message).toContain("3 spot(s) left");
      expect(message).toContain("https://example.com/events/abc123");
    });

    it("formats message without location", () => {
      const data: WhatsAppMessageData = {
        title: "Wednesday Game",
        date: new Date("2024-01-10T19:00:00"),
        location: null,
        spotsLeft: 5,
        maxPlayers: 12,
        eventUrl: "https://example.com/events/def456",
      };

      const message = formatWhatsAppMessage(data, mockT);

      expect(message).toContain("Wednesday Game");
      expect(message).not.toContain("📍");
      expect(message).toContain("5 spot(s) left");
    });

    it("formats message when game is full", () => {
      const data: WhatsAppMessageData = {
        title: "Full Game",
        date: new Date("2024-01-20T20:00:00"),
        location: "Stadium",
        spotsLeft: 0,
        maxPlayers: 10,
        eventUrl: "https://example.com/events/full",
      };

      const message = formatWhatsAppMessage(data, mockT);

      expect(message).toContain("Full");
      expect(message).toContain("Stadium");
      expect(message).toContain("Full Game");
    });
  });

  describe("getWhatsAppUrl", () => {
    it("generates mobile URL when isMobile is true", () => {
      const url = getWhatsAppUrl("Test message", true);
      expect(url).toBe("whatsapp://send?text=Test%20message");
    });

    it("generates web URL when isMobile is false", () => {
      const url = getWhatsAppUrl("Test message", false);
      expect(url).toBe("https://web.whatsapp.com/send?text=Test%20message");
    });

    it("encodes special characters in message", () => {
      const url = getWhatsAppUrl("Test with émojis 🏈 and spaces", false);
      expect(url).toContain("Test%20with%20");
      expect(url).toContain("%20and%20spaces");
    });
  });
});