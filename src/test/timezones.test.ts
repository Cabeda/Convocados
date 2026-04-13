import { describe, it, expect } from "vitest";
import { formatDateInTz, toDateTimeLocalValue, detectTimezone } from "~/lib/timezones";

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
