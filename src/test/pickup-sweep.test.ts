import { describe, it, expect } from "vitest";
import { detectBookedSlots } from "~/lib/pickupSweep";
import type { PlaytomicCourtAvailability } from "~/lib/playtomic.server";

const slot = (start: string, duration = 60): { start_time: string; duration: number; price: number | null; currency: string | null } => ({ start_time: start, duration, price: null, currency: null });
const court = (id: string, name: string, slots: Array<{ start_time: string; duration: number; price: number | null; currency: string | null }>): PlaytomicCourtAvailability => ({
  resource_id: id,
  resource_name: name,
  slots,
});

describe("detectBookedSlots", () => {
  it("returns no bookings when the court is free all day (no gaps)", () => {
    const freeStarts = ["07:00", "07:30", "08:00", "08:30", "09:00"];
    const courts = [court("c1", "Court 1", freeStarts.map((s) => slot(s)))];
    const result = detectBookedSlots(courts, { minDurationMinutes: 90, maxDurationMinutes: 120 });
    expect(result).toEqual([]);
  });

  it("detects a 90-minute booking as a run of three missing 30-min slots", () => {
    const freeStarts = ["17:00", "19:00", "19:30", "20:00"];
    const courts = [court("c1", "Court 1", freeStarts.map((s) => slot(s)))];
    const result = detectBookedSlots(courts, { minDurationMinutes: 90, maxDurationMinutes: 120 });
    expect(result).toEqual([
      { resourceId: "c1", resourceName: "Court 1", startTime: "17:30", durationMinutes: 90 },
    ]);
  });

  it("skips a gap that touches the grid edge (club may not offer that slot)", () => {
    const freeStarts = ["07:30", "08:00", "08:30", "09:00"];
    const courts = [court("c1", "Court 1", freeStarts.map((s) => slot(s)))];
    const result = detectBookedSlots(courts, { minDurationMinutes: 30, maxDurationMinutes: 120 });
    // 07:00 is before the grid (07:30 start) — skipped. 09:30 beyond end — skipped.
    expect(result).toEqual([]);
  });

  it("detects multiple separate 60-minute bookings on one court", () => {
    const freeStarts = ["09:00", "10:30", "11:30", "13:00", "14:00"];
    const courts = [court("c1", "Court 1", freeStarts.map((s) => slot(s)))];
    const result = detectBookedSlots(courts, { minDurationMinutes: 60, maxDurationMinutes: 120 });
    // Gaps: 09:30-10:00 (60min) and 12:00-12:30 (60min) — each bounded by free slots.
    expect(result).toEqual([
      { resourceId: "c1", resourceName: "Court 1", startTime: "09:30", durationMinutes: 60 },
      { resourceId: "c1", resourceName: "Court 1", startTime: "12:00", durationMinutes: 60 },
    ]);
  });

  it("caps booking duration at the max duration", () => {
    // Free at 10:00 and 12:30 → missing 10:30, 11:00, 11:30, 12:00 (120min run),
    // bounded by free slots on both sides. min 30 → 120, capped to 90.
    const freeStarts = ["10:00", "12:30"];
    const courts = [court("c1", "Court 1", freeStarts.map((s) => slot(s)))];
    const result = detectBookedSlots(courts, { minDurationMinutes: 30, maxDurationMinutes: 90 });
    expect(result).toEqual([
      { resourceId: "c1", resourceName: "Court 1", startTime: "10:30", durationMinutes: 90 },
    ]);
  });

  it("handles multiple courts independently", () => {
    const courts = [
      court("c1", "Court 1", ["18:00", "19:30"].map((s) => slot(s))), // booked 18:30-19:00 (60min)
      court("c2", "Court 2", ["18:00", "18:30"].map((s) => slot(s))), // no gap
    ];
    const result = detectBookedSlots(courts, { minDurationMinutes: 60, maxDurationMinutes: 90 });
    expect(result).toEqual([
      { resourceId: "c1", resourceName: "Court 1", startTime: "18:30", durationMinutes: 60 },
    ]);
  });
});