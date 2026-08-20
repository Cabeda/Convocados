/**
 * Open Pickups (ADR-0021): server-side creation of pickup Events from detected
 * Playtomic booked slots. Idempotent on a natural key so a twice-daily sweep
 * never creates duplicates for the same court slot.
 */

import { prisma } from "./db.server";
import { fromDateTimeLocalValue } from "./timezones";
import { getSportPreset } from "./sports";
import { createT } from "./i18n";
import { searchClubs } from "./playtomic.server";
import { getCachedAvailability } from "./availabilityCache.server";
import { detectBookedSlots } from "./pickupSweep";

const tEn = createT("en");

export interface PickupSlotInput {
  resourceId: string;
  resourceName: string;
  startTime: string; // "HH:mm" club-local
  durationMinutes: number;
}

export interface PickupEventInput {
  tenantId: string;
  tenantName: string;
  address: string | null;
  coordinate: { lat: number; lng: number } | null;
  sport: string;
  date: string; // YYYY-MM-DD (club-local date)
  slot: PickupSlotInput;
  timezone: string; // anchor city timezone
}

export function pickupSourceKey(input: PickupEventInput): string {
  return `${input.tenantId}|${input.slot.resourceId}|${input.date}|${input.slot.startTime}`;
}

function weekdayLabel(dateTime: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en", { weekday: "short", timeZone: timezone }).format(dateTime);
}

/** Create (or return the existing) Event+Game for a detected booked slot. */
export async function createPickupEvent(input: PickupEventInput) {
  const sourceKey = pickupSourceKey(input);
  const existing = await prisma.event.findUnique({ where: { sourceKey } });
  if (existing) return existing;

  const preset = getSportPreset(input.sport);
  const dateTime = new Date(fromDateTimeLocalValue(`${input.date}T${input.slot.startTime}`, input.timezone));

  try {
    const event = await prisma.event.create({
      data: {
        title: `${tEn(preset.labelKey)} — ${input.tenantName} (${weekdayLabel(dateTime, input.timezone)} ${input.slot.startTime})`,
        location: input.address ?? input.tenantName,
        latitude: input.coordinate?.lat ?? null,
        longitude: input.coordinate?.lng ?? null,
        dateTime,
        timezone: input.timezone,
        maxPlayers: preset.defaultMaxPlayers,
        durationMinutes: preset.defaultDurationMinutes,
        sport: input.sport,
        isPublic: true,
        isRecurring: false,
        source: "playtomic",
        sourceKey,
        playtomicTenantId: input.tenantId,
        playtomicTenantName: input.tenantName,
      },
    });

    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime },
    });

    await prisma.event.update({
      where: { id: event.id },
      data: { currentGameId: game.id },
    });

    return event;
  } catch (err) {
    // Concurrent sweep created the same slot first — return the existing row.
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      const winner = await prisma.event.findUnique({ where: { sourceKey } });
      if (winner) return winner;
    }
    throw err;
  }
}

/**
 * Archive un-adopted pickups whose slot has passed (plus a grace period).
 * Adopted pickups are ordinary events — never touched here. Returns the count
 * of events archived.
 */
export async function archiveExpiredPickups(options: { graceMinutes?: number } = {}): Promise<number> {
  const graceMs = (options.graceMinutes ?? 120) * 60 * 1000;
  const cutoff = new Date(Date.now() - graceMs);

  const expired = await prisma.event.findMany({
    where: {
      source: "playtomic",
      ownerId: null,
      archivedAt: null,
      dateTime: { lte: cutoff },
    },
    select: { id: true, currentGameId: true },
  });

  if (expired.length === 0) return 0;

  await prisma.$transaction([
    ...expired.map((e) =>
      prisma.event.update({ where: { id: e.id }, data: { archivedAt: new Date() } }),
    ),
    ...expired.flatMap((e) =>
      e.currentGameId
        ? [prisma.game.update({ where: { id: e.currentGameId }, data: { status: "cancelled" } })]
        : [],
    ),
  ]);

  return expired.length;
}

// ── Sweep orchestration ───────────────────────────────────────────────────────

export interface SweepAnchor {
  city: string;
  lat: number;
  lng: number;
  timezone: string;
  radius?: number;
}

export interface SweepResult {
  anchors: number;
  clubs: number;
  created: number;
  skipped: number;
  errors: string[];
}

const SWEEP_SPORTS = [
  "padel",
  "tennis-singles",
  "tennis-doubles",
  "football-5v5",
  "football-7v7",
  "futsal",
  "badminton-singles",
  "badminton-doubles",
  "squash",
  "pickleball",
];

const DEFAULT_ANCHORS: SweepAnchor[] = [
  { city: "Porto", lat: 41.14961, lng: -8.61099, timezone: "Europe/Lisbon" },
  { city: "Lisbon", lat: 38.72225, lng: -9.13934, timezone: "Europe/Lisbon" },
];

const LOOKAHEAD_DAYS = 7;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Next N dates from today, YYYY-MM-DD (UTC). */
export function upcomingDates(lookaheadDays: number): string[] {
  const dates: string[] = [];
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i <= lookaheadDays; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Run the pickup sweep across anchors and sports. Returns aggregate counts.
 * Failures are per-club — a single dead club never aborts the sweep.
 */
export async function runPickupSweep(anchors: SweepAnchor[], options: { lookaheadDays?: number } = {}): Promise<SweepResult> {
  const lookaheadDays = options.lookaheadDays ?? LOOKAHEAD_DAYS;
  const dates = upcomingDates(lookaheadDays);
  const result: SweepResult = { anchors: anchors.length, clubs: 0, created: 0, skipped: 0, errors: [] };

  const { mapWithConcurrency } = await import("./availabilityCache.server");

  for (const anchor of anchors) {
    for (const sport of SWEEP_SPORTS) {
      const { clubs, error } = await searchClubs({
        lat: anchor.lat,
        lng: anchor.lng,
        sport,
        radius: anchor.radius ?? 15000,
        size: 20,
      });
      if (error) {
        result.errors.push(`search ${sport} @ ${anchor.city}: ${error}`);
        continue;
      }
      result.clubs += clubs.length;

      const preset = getSportPreset(sport);
      await mapWithConcurrency(clubs, 3, async (club) => {
        try {
          for (const date of dates) {
            const { courts, error: availError } = await getCachedAvailability({
              tenantId: club.tenant_id,
              sport,
              date,
            });
            if (availError) continue;

            const bookings = detectBookedSlots(courts, {
              minDurationMinutes: preset.defaultDurationMinutes,
              maxDurationMinutes: 120,
            });
            for (const booking of bookings) {
              await createPickupEvent({
                tenantId: club.tenant_id,
                tenantName: club.tenant_name,
                address: club.address
                  ? [club.address.street, club.address.city].filter(Boolean).join(", ")
                  : null,
                coordinate: club.coordinate
                  ? { lat: club.coordinate.lat, lng: club.coordinate.lon }
                  : null,
                sport,
                date,
                slot: {
                  resourceId: booking.resourceId,
                  resourceName: booking.resourceName,
                  startTime: booking.startTime,
                  durationMinutes: booking.durationMinutes,
                },
                timezone: anchor.timezone,
              });
              result.created++;
            }
            await sleep(200); // pace Playtomic calls (ADR-0021)
          }
        } catch (err) {
          result.errors.push(`club ${club.tenant_id} @ ${anchor.city}: ${String(err)}`);
          result.skipped++;
        }
      });
    }
  }

  return result;
}

export function resolveAnchors(): SweepAnchor[] {
  const raw = process.env.SWEEP_ANCHORS ?? import.meta.env.SWEEP_ANCHORS ?? "";
  if (!raw) return DEFAULT_ANCHORS;
  try {
    const parsed = JSON.parse(raw) as SweepAnchor[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fall through to defaults
  }
  return DEFAULT_ANCHORS;
}