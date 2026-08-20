/**
 * Open Pickups (ADR-0021): detect booked Playtomic court slots.
 * Pure functions — no DB or network — so they are unit-testable in isolation.
 *
 * Playtomic's availability endpoint returns only FREE slots per court across
 * the day (30-minute grid, multiple durations per start time). A booked slot is
 * a start time in the grid that is absent from the free list. We only trust a
 * gap when it is bounded by free slots on both sides — an isolated booking block
 * — so we never invent games at times the club simply doesn't offer (day edges).
 */

export interface DetectedBookedSlot {
  resourceId: string;
  resourceName: string;
  startTime: string; // "HH:mm" (club-local)
  durationMinutes: number;
}

export interface DetectOptions {
  minDurationMinutes: number; // sport's minimum booking length; shorter gaps are not a full game
  maxDurationMinutes: number; // cap for the surfaced game duration (e.g. 120)
}

const GRID_STEP_MINUTES = 30;

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Detect booked slots for a list of courts (free availability per court). */
export function detectBookedSlots(
  courts: Array<{ resource_id: string; resource_name: string; slots: Array<{ start_time: string }> }>,
  options: DetectOptions,
): DetectedBookedSlot[] {
  const bookings: DetectedBookedSlot[] = [];

  for (const court of courts) {
    const freeStarts = new Set(court.slots.map((s) => toMinutes(s.start_time)));
    if (freeStarts.size < 2) continue; // need at least a pair of free slots to bound a gap

    const gridStart = Math.min(...freeStarts);
    const gridEnd = Math.max(...freeStarts);

    // Walk the grid and group consecutive missing slots into runs.
    let runStart: number | null = null;
    for (let t = gridStart; t <= gridEnd; t += GRID_STEP_MINUTES) {
      const isFree = freeStarts.has(t);
      if (!isFree && runStart === null) runStart = t;
      if (isFree && runStart !== null) {
        emitRun(runStart, t - GRID_STEP_MINUTES, gridStart, gridEnd, court, bookings, options);
        runStart = null;
      }
    }
    if (runStart !== null) emitRun(runStart, gridEnd, gridStart, gridEnd, court, bookings, options);
  }

  return bookings;
}

function emitRun(
  start: number,
  end: number,
  gridStart: number,
  gridEnd: number,
  court: { resource_id: string; resource_name: string },
  bookings: DetectedBookedSlot[],
  options: DetectOptions,
) {
  // Skip runs touching the grid edges — the club may not offer that slot at all.
  if (start <= gridStart || end >= gridEnd) return;

  const runMinutes = end - start + GRID_STEP_MINUTES;
  if (runMinutes < options.minDurationMinutes) return;

  bookings.push({
    resourceId: court.resource_id,
    resourceName: court.resource_name,
    startTime: toHHMM(start),
    durationMinutes: Math.min(runMinutes, options.maxDurationMinutes),
  });
}
