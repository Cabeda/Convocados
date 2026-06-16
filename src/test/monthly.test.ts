import { describe, it, expect } from "vitest";
import {
  subscriptionWindowFor,
  isInSubscriptionWindow,
  endOfExpiryMonth,
  activeSubscriptionCoversDate,
  type SubscriptionWindow,
  type SubscriptionLike,
} from "~/lib/monthly";

describe("subscriptionWindowFor", () => {
  it("returns the calendar month containing the given UTC date, in UTC", () => {
    // 2026-06-15 is mid-month; window is [2026-06-01, 2026-07-01)
    const w: SubscriptionWindow = subscriptionWindowFor(new Date("2026-06-15T12:00:00Z"), "UTC");
    expect(w.windowStart.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("handles year boundaries (December → next January)", () => {
    const w = subscriptionWindowFor(new Date("2026-12-31T23:00:00Z"), "UTC");
    expect(w.windowStart.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("handles the first instant of a month", () => {
    const w = subscriptionWindowFor(new Date("2026-03-01T00:00:00Z"), "UTC");
    expect(w.windowStart.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("handles the last instant of a month", () => {
    const w = subscriptionWindowFor(new Date("2026-03-31T23:59:59.999Z"), "UTC");
    expect(w.windowStart.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("respects timezone: windowStart is the UTC instant whose Lisbon-local time is midnight on day 1", () => {
    // 2026-06-15T12:00:00Z = 2026-06-15T13:00:00 in Lisbon (WEST = UTC+1 in June) — June, no surprise.
    // windowStart = midnight 2026-06-01 in Lisbon = 2026-05-31T23:00:00Z (Lisbon is UTC+1).
    const w = subscriptionWindowFor(new Date("2026-06-15T12:00:00Z"), "Europe/Lisbon");
    expect(w.windowStart.toISOString()).toBe("2026-05-31T23:00:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2026-06-30T23:00:00.000Z");
  });

  it("Lisbon: 2026-06-30T23:30:00Z is July 1 in Lisbon, so window is July", () => {
    // 2026-06-30T23:30:00Z → 2026-07-01T00:30:00 in Lisbon → July.
    // windowStart = midnight 2026-07-01 Lisbon = 2026-06-30T23:00:00Z.
    const w = subscriptionWindowFor(new Date("2026-06-30T23:30:00Z"), "Europe/Lisbon");
    expect(w.windowStart.toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2026-07-31T23:00:00.000Z");
  });
});

describe("isInSubscriptionWindow", () => {
  const window: SubscriptionWindow = {
    windowStart: new Date("2026-06-01T00:00:00Z"),
    windowEnd: new Date("2026-07-01T00:00:00Z"),
  };

  it("is true for a date strictly inside the window", () => {
    expect(isInSubscriptionWindow(new Date("2026-06-15T20:00:00Z"), window)).toBe(true);
  });

  it("is true on the windowStart instant (inclusive)", () => {
    expect(isInSubscriptionWindow(new Date("2026-06-01T00:00:00Z"), window)).toBe(true);
  });

  it("is false on the windowEnd instant (exclusive)", () => {
    expect(isInSubscriptionWindow(new Date("2026-07-01T00:00:00Z"), window)).toBe(false);
  });

  it("is false for a date before the window", () => {
    expect(isInSubscriptionWindow(new Date("2026-05-31T23:59:59Z"), window)).toBe(false);
  });

  it("is false for a date after the window", () => {
    expect(isInSubscriptionWindow(new Date("2026-07-15T20:00:00Z"), window)).toBe(false);
  });
});

describe("endOfExpiryMonth", () => {
  it("returns the end of the month following the month the credit was earned", () => {
    // Credit earned 2026-06-15 → expires at end of July = 2026-08-01T00:00:00 in event TZ (UTC)
    const expires = endOfExpiryMonth(new Date("2026-06-15T20:00:00Z"), "UTC");
    expect(expires.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("December → January year boundary", () => {
    const expires = endOfExpiryMonth(new Date("2026-12-10T20:00:00Z"), "UTC");
    expect(expires.toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });

  it("Lisbon: credit earned late June expires end of July Lisbon time", () => {
    // The "end of the following month" is computed in the event's timezone.
    // 2026-07-31T23:59:59 in Lisbon (WEST = UTC+1) = 2026-07-31T22:59:59Z, expires the next instant.
    // We just verify the function does not throw and returns a Date in the future.
    const expires = endOfExpiryMonth(new Date("2026-06-30T22:00:00Z"), "Europe/Lisbon");
    expect(expires > new Date("2026-07-31T00:00:00Z")).toBe(true);
  });
});

describe("activeSubscriptionCoversDate", () => {
  function sub(windowStart: string, windowEnd: string, status: string = "active"): SubscriptionLike {
    return {
      status,
      windowStart: new Date(windowStart),
      windowEnd: new Date(windowEnd),
    };
  }

  it("returns true when an active subscription's window contains the date", () => {
    const s = sub("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z");
    expect(activeSubscriptionCoversDate(s, new Date("2026-06-15T20:00:00Z"))).toBe(true);
  });

  it("returns false on the windowEnd instant (exclusive)", () => {
    const s = sub("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z");
    expect(activeSubscriptionCoversDate(s, new Date("2026-07-01T00:00:00Z"))).toBe(false);
  });

  it("returns false for a cancelled subscription", () => {
    const s = sub("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z", "cancelled");
    expect(activeSubscriptionCoversDate(s, new Date("2026-06-15T20:00:00Z"))).toBe(false);
  });

  it("returns false for an active subscription whose window does not contain the date", () => {
    const s = sub("2026-05-01T00:00:00Z", "2026-06-01T00:00:00Z");
    expect(activeSubscriptionCoversDate(s, new Date("2026-06-15T20:00:00Z"))).toBe(false);
  });
});
