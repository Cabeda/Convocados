/**
 * Court alternatives search logic.
 * Finds Playtomic slots matching an event's time (±30 min) and filters.
 */

import { searchClubs, getAvailability } from "./playtomic.server";
import { isPlaytomicSport } from "./playtomic";

export interface CourtWatchConfig {
  radius: number;        // meters, default 10000
  indoor: boolean | null; // null = no preference
  surface: string | null; // null = no preference
}

export interface CourtAlternative {
  tenantId: string;
  tenantName: string;
  resourceId: string;
  resourceName: string;
  slotTime: string;    // "HH:mm"
  slotDate: string;    // "YYYY-MM-DD"
  duration: number;
  price: number;
  currency: string;
  coordinate: { lat: number; lon: number } | null;
  address: string | null;
  playtomicUrl: string;
  imageUrl: string | null;
  distanceKm: number | null;
}

export interface SearchAlternativesParams {
  sport: string;
  dateTime: Date;
  durationMinutes: number;
  latitude: number;
  longitude: number;
  config: CourtWatchConfig;
  maxClubs?: number; // default 5
  startTime?: string; // "HH:mm" — override time filter start
  endTime?: string;   // "HH:mm" — override time filter end
}

const DEFAULT_TIME_TOLERANCE_MINUTES = 30;

/** Haversine distance in km */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Parse "HH:mm:ss" or "HH:mm" to minutes since midnight */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Check if a slot's start time is within the time window */
function isTimeMatch(slotTime: string, targetDate: Date, startTime?: string, endTime?: string): boolean {
  const slotMinutes = timeToMinutes(slotTime);
  if (startTime && endTime) {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    return slotMinutes >= start && slotMinutes <= end;
  }
  const targetMinutes = targetDate.getUTCHours() * 60 + targetDate.getUTCMinutes();
  return Math.abs(slotMinutes - targetMinutes) <= DEFAULT_TIME_TOLERANCE_MINUTES;
}

/** Format Date to YYYY-MM-DD */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Search for court alternatives matching an event's criteria.
 * Returns matching slots sorted by price (cheapest first).
 */
export async function searchCourtAlternatives(params: SearchAlternativesParams): Promise<{ alternatives: CourtAlternative[]; error?: string }> {
  if (!isPlaytomicSport(params.sport)) {
    return { alternatives: [], error: "Sport not supported by Playtomic" };
  }

  const maxClubs = params.maxClubs ?? 5;
  const dateStr = toDateStr(params.dateTime);

  // 1. Find nearby clubs
  const { clubs, error: clubsError } = await searchClubs({
    lat: params.latitude,
    lng: params.longitude,
    sport: params.sport,
    radius: params.config.radius,
    size: maxClubs,
  });

  if (clubsError) return { alternatives: [], error: clubsError };
  if (clubs.length === 0) return { alternatives: [] };

  // 2. Check availability for each club (with 200ms delay between calls)
  const alternatives: CourtAlternative[] = [];

  for (const club of clubs.slice(0, maxClubs)) {
    const { courts, error: availError } = await getAvailability({
      tenantId: club.tenant_id,
      date: dateStr,
      sport: params.sport,
      duration: params.durationMinutes,
    });

    if (availError) continue; // skip this club, don't fail entire search

    for (const court of courts) {
      const matchingSlots = court.slots.filter(
        (s) => isTimeMatch(s.start_time, params.dateTime, params.startTime, params.endTime) && s.duration >= params.durationMinutes,
      );

      for (const slot of matchingSlots) {
        const distanceKm = club.coordinate
          ? Math.round(haversineKm(params.latitude, params.longitude, club.coordinate.lat, club.coordinate.lon) * 10) / 10
          : null;

        alternatives.push({
          tenantId: club.tenant_id,
          tenantName: club.tenant_name,
          resourceId: court.resource_id,
          resourceName: court.resource_name,
          slotTime: slot.start_time.slice(0, 5), // "HH:mm"
          slotDate: dateStr,
          duration: slot.duration,
          price: slot.price,
          currency: slot.currency,
          coordinate: club.coordinate,
          address: club.address ? [club.address.street, club.address.city].filter(Boolean).join(", ") : null,
          playtomicUrl: `https://playtomic.io/tenant/${club.tenant_id}/booking/${dateStr}?resource_id=${court.resource_id}&start=${slot.start_time}`,
          imageUrl: club.images[0] || null,
          distanceKm,
        });
      }
    }

    // Rate limiting: 200ms delay between Playtomic API calls
    if (clubs.indexOf(club) < clubs.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Sort by price ascending
  alternatives.sort((a, b) => a.price - b.price);

  return { alternatives };
}

/** Parse courtWatchConfig JSON from DB. Returns null if invalid or empty. */
export function parseCourtWatchConfig(raw: string | null): CourtWatchConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.radius !== "number") return null;
    return {
      radius: parsed.radius,
      indoor: parsed.indoor ?? null,
      surface: parsed.surface ?? null,
    };
  } catch {
    return null;
  }
}
