import { describe, it, expect } from "vitest";
import { formatDateInTz, toDateTimeLocalValue, fromDateTimeLocalValue, detectTimezone } from "~/lib/timezones";

describe("formatDateInTz", () => {
  // 2024-07-15T19:00:00Z — summer, so Europe/Lisbon is UTC+1 (WEST)
  const summerUtc = new Date("2024-07-15T19:00:00Z");

  // 2024-01-15T19:00:00Z — winter, so Europe/Lisbon is UTC+0 (WET)
  const winterUtc = new Date("2024-01-15T19:00:00Z");

  it("formats time in the event timezone, not browser local", () => {
    // 19:00 UTC in Europe/Lisbon during summer (UTC+1) should show 20:00
    const result = formatDateInTz(summerUtc, "en-GB", "Europe/Lisbon", {
      hour: "2-digit", minute: "2-digit",
    });
    expect(result).toContain("20:00");
  });

  it("formats time in UTC when timezone is UTC", () => {
    const result = formatDateInTz(summerUtc, "en-GB", "UTC", {
      hour: "2-digit", minute: "2-digit",
    });
    expect(result).toContain("19:00");
  });

  it("formats winter time correctly for Europe/Lisbon (UTC+0)", () => {
    // 19:00 UTC in winter Lisbon (UTC+0) should show 19:00
    const result = formatDateInTz(winterUtc, "en-GB", "Europe/Lisbon", {
      hour: "2-digit", minute: "2-digit",
    });
    expect(result).toContain("19:00");
  });

  it("formats time in America/New_York (UTC-4 summer)", () => {
    // 19:00 UTC in summer New York (UTC-4) should show 15:00
    const result = formatDateInTz(summerUtc, "en-GB", "America/New_York", {
      hour: "2-digit", minute: "2-digit",
    });
    expect(result).toContain("15:00");
  });

  it("includes date parts when requested", () => {
    const result = formatDateInTz(summerUtc, "en-GB", "UTC", {
      weekday: "short", month: "short", day: "numeric",
    });
    expect(result).toContain("Mon");
    expect(result).toContain("15");
    expect(result).toContain("Jul");
  });

  it("falls back to UTC for empty timezone string", () => {
    const result = formatDateInTz(summerUtc, "en-GB", "", {
      hour: "2-digit", minute: "2-digit",
    });
    expect(result).toContain("19:00");
  });
});

describe("toDateTimeLocalValue", () => {
  // 2024-07-15T19:00:00Z — summer
  const summerUtc = new Date("2024-07-15T19:00:00Z");

  it("converts UTC date to event timezone for datetime-local input", () => {
    // 19:00 UTC in Europe/Lisbon summer (UTC+1) → 2024-07-15T20:00
    const result = toDateTimeLocalValue(summerUtc, "Europe/Lisbon");
    expect(result).toBe("2024-07-15T20:00");
  });

  it("returns UTC time when timezone is UTC", () => {
    const result = toDateTimeLocalValue(summerUtc, "UTC");
    expect(result).toBe("2024-07-15T19:00");
  });

  it("handles America/New_York (UTC-4 summer)", () => {
    // 19:00 UTC → 15:00 EDT
    const result = toDateTimeLocalValue(summerUtc, "America/New_York");
    expect(result).toBe("2024-07-15T15:00");
  });

  it("handles date rollover across timezone boundary", () => {
    // 2024-07-16T01:00:00Z in Asia/Tokyo (UTC+9) → 2024-07-16T10:00
    const date = new Date("2024-07-16T01:00:00Z");
    const result = toDateTimeLocalValue(date, "Asia/Tokyo");
    expect(result).toBe("2024-07-16T10:00");
  });

  it("handles date rollback across timezone boundary", () => {
    // 2024-07-16T02:00:00Z in America/Los_Angeles (UTC-7 summer) → 2024-07-15T19:00
    const date = new Date("2024-07-16T02:00:00Z");
    const result = toDateTimeLocalValue(date, "America/Los_Angeles");
    expect(result).toBe("2024-07-15T19:00");
  });

  it("falls back to UTC for empty timezone", () => {
    const result = toDateTimeLocalValue(summerUtc, "");
    expect(result).toBe("2024-07-15T19:00");
  });

  it("winter Europe/Lisbon (UTC+0) keeps same time", () => {
    const winterUtc = new Date("2024-01-15T19:00:00Z");
    const result = toDateTimeLocalValue(winterUtc, "Europe/Lisbon");
    expect(result).toBe("2024-01-15T19:00");
  });
});

describe("detectTimezone", () => {
  it("returns a non-empty string", () => {
    const tz = detectTimezone();
    expect(tz).toBeTruthy();
    expect(typeof tz).toBe("string");
  });
});

describe("fromDateTimeLocalValue", () => {
  it("converts Lisbon summer time to UTC (UTC+1 → subtract 1h)", () => {
    // 20:00 Lisbon summer (UTC+1) → 19:00 UTC
    const result = fromDateTimeLocalValue("2024-07-15T20:00", "Europe/Lisbon");
    expect(result).toBe("2024-07-15T19:00:00.000Z");
  });

  it("converts Lisbon winter time to UTC (UTC+0 → same)", () => {
    // 19:00 Lisbon winter (UTC+0) → 19:00 UTC
    const result = fromDateTimeLocalValue("2024-01-15T19:00", "Europe/Lisbon");
    expect(result).toBe("2024-01-15T19:00:00.000Z");
  });

  it("converts UTC to UTC (no change)", () => {
    const result = fromDateTimeLocalValue("2024-07-15T19:00", "UTC");
    expect(result).toBe("2024-07-15T19:00:00.000Z");
  });

  it("converts New York summer time to UTC (UTC-4 → add 4h)", () => {
    // 15:00 EDT (UTC-4) → 19:00 UTC
    const result = fromDateTimeLocalValue("2024-07-15T15:00", "America/New_York");
    expect(result).toBe("2024-07-15T19:00:00.000Z");
  });

  it("handles date rollover (Tokyo UTC+9)", () => {
    // 10:00 JST (UTC+9) → 01:00 UTC same day
    const result = fromDateTimeLocalValue("2024-07-16T10:00", "Asia/Tokyo");
    expect(result).toBe("2024-07-16T01:00:00.000Z");
  });

  it("handles date rollback (LA UTC-7 summer)", () => {
    // 19:00 PDT (UTC-7) on Jul 15 → 02:00 UTC on Jul 16
    const result = fromDateTimeLocalValue("2024-07-15T19:00", "America/Los_Angeles");
    expect(result).toBe("2024-07-16T02:00:00.000Z");
  });

  it("falls back to UTC for empty timezone", () => {
    const result = fromDateTimeLocalValue("2024-07-15T19:00", "");
    expect(result).toBe("2024-07-15T19:00:00.000Z");
  });

  it("round-trips with toDateTimeLocalValue", () => {
    const original = new Date("2024-07-15T19:00:00.000Z");
    const timezones = ["Europe/Lisbon", "America/New_York", "Asia/Tokyo", "UTC", "America/Los_Angeles"];
    for (const tz of timezones) {
      const local = toDateTimeLocalValue(original, tz);
      const backToUtc = fromDateTimeLocalValue(local, tz);
      expect(backToUtc).toBe(original.toISOString());
    }
  });

  it("round-trips winter dates correctly", () => {
    const original = new Date("2024-01-15T19:00:00.000Z");
    const timezones = ["Europe/Lisbon", "America/New_York", "Asia/Tokyo", "UTC"];
    for (const tz of timezones) {
      const local = toDateTimeLocalValue(original, tz);
      const backToUtc = fromDateTimeLocalValue(local, tz);
      expect(backToUtc).toBe(original.toISOString());
    }
  });
});
