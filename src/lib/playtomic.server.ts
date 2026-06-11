/**
 * Server-side Playtomic API client.
 * Uses the public api.playtomic.io endpoints (no auth required for search).
 * Proxied through our API to avoid CORS and add rate limiting.
 */

// Re-export shared utilities
export { mapSportToPlaytomic, isPlaytomicSport } from "./playtomic";
import { mapSportToPlaytomic } from "./playtomic";

const PLAYTOMIC_API = "https://api.playtomic.io/v1";

// ── Types ─────────────────────────────────────────────────────────────────────


interface PlaytomicRawClub {
  tenant_id?: string;
  tenant_name?: string;
  address?: {
    street?: string;
    city?: string;
    postal_code?: string;
    country?: string;
    coordinate?: { lat: number; lon: number };
  } | null;
  images?: Array<{ image_url?: string }>;
}

interface PlaytomicRawCourt {
  resource_id?: string;
  resource_name?: string;
  name?: string;
  slots?: Array<{
    start_time?: string;
    duration?: number;
    price?: number | string; // Real API returns combined string e.g. "72 GBP"; some responses use a number + separate currency
    currency?: string;
  }>;
}

/**
 * Parse a Playtomic slot price into a numeric amount + ISO currency code.
 * The live API returns price as a combined string like "72 GBP" or "24.5 EUR"
 * (no separate currency field). Older/mocked responses may provide a numeric
 * price with a separate currency field. Handles both.
 * Returns { price: null, currency: null } when no valid price is present.
 */
export function parsePlaytomicPrice(
  rawPrice: number | string | undefined | null,
  rawCurrency?: string,
): { price: number | null; currency: string | null } {
  if (typeof rawPrice === "number" && !isNaN(rawPrice)) {
    return { price: rawPrice, currency: rawCurrency ?? "EUR" };
  }
  if (typeof rawPrice === "string") {
    // Match "<amount> <CURRENCY>" e.g. "72 GBP", "24.5 EUR"
    const match = rawPrice.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*([A-Za-z]{3})?$/);
    if (match) {
      const amount = parseFloat(match[1].replace(",", "."));
      if (!isNaN(amount)) {
        return { price: amount, currency: match[2]?.toUpperCase() ?? rawCurrency ?? "EUR" };
      }
    }
  }
  return { price: null, currency: null };
}

export interface PlaytomicClub {
  tenant_id: string;
  tenant_name: string;
  address: {
    street: string;
    city: string;
    postal_code: string;
    country: string;
  } | null;
  coordinate: { lat: number; lon: number } | null;
  images: string[];
}

export interface PlaytomicSlot {
  start_time: string; // "HH:mm:ss"
  duration: number;   // minutes
  price: number | null;   // null when Playtomic doesn't expose a price
  currency: string | null;
}

export interface PlaytomicCourtAvailability {
  resource_id: string;
  resource_name: string;
  slots: PlaytomicSlot[];
}

// ── API calls ─────────────────────────────────────────────────────────────────

export interface SearchClubsParams {
  lat: number;
  lng: number;
  sport: string; // Convocados sport ID
  radius?: number; // meters, default 15000
  size?: number;   // max results, default 20
}

export interface SearchClubsResult {
  clubs: PlaytomicClub[];
  error?: string;
}

/** Search for clubs near a location. */
export async function searchClubs(params: SearchClubsParams): Promise<SearchClubsResult> {
  const playtomicSport = mapSportToPlaytomic(params.sport);
  if (!playtomicSport) {
    return { clubs: [], error: "Unsupported sport for Playtomic search" };
  }

  const radius = params.radius ?? 15000;
  const size = params.size ?? 20;

  const url = `${PLAYTOMIC_API}/tenants?coordinate=${params.lat},${params.lng}&sport_id=${playtomicSport}&radius=${radius}&size=${size}&playtomic_status=ACTIVE`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Convocados/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { clubs: [], error: `Playtomic API returned ${res.status}` };
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      return { clubs: [], error: "Unexpected response format" };
    }

    const clubs: PlaytomicClub[] = data.map((t: PlaytomicRawClub) => ({
      tenant_id: t.tenant_id ?? "",
      tenant_name: t.tenant_name ?? "",
      address: t.address
        ? {
            street: t.address.street ?? "",
            city: t.address.city ?? "",
            postal_code: t.address.postal_code ?? "",
            country: t.address.country ?? "",
          }
        : null,
      coordinate: t.address?.coordinate
        ? { lat: t.address.coordinate.lat, lon: t.address.coordinate.lon }
        : null,
      images: Array.isArray(t.images) ? t.images.map((img: { image_url?: string }) => img.image_url ?? "") : [],
    }));

    return { clubs };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { clubs: [], error: message };
  }
}

export interface GetAvailabilityParams {
  tenantId: string;
  date: string; // YYYY-MM-DD
  sport: string; // Convocados sport ID
  duration?: number; // minutes, default 90
}

export interface GetAvailabilityResult {
  courts: PlaytomicCourtAvailability[];
  error?: string;
}

/** Get court availability for a specific club and date. */
export async function getAvailability(params: GetAvailabilityParams): Promise<GetAvailabilityResult> {
  const playtomicSport = mapSportToPlaytomic(params.sport);
  if (!playtomicSport) {
    return { courts: [], error: "Unsupported sport for Playtomic search" };
  }

  const duration = params.duration ?? 90;
  const url = `${PLAYTOMIC_API}/availability?tenant_id=${params.tenantId}&sport_id=${playtomicSport}&local_start_min=${params.date}T00:00:00&local_start_max=${params.date}T23:59:59`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Convocados/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { courts: [], error: `Playtomic API returned ${res.status}` };
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      return { courts: [], error: "Unexpected response format" };
    }

    const courts: PlaytomicCourtAvailability[] = data.map((court: PlaytomicRawCourt) => ({
      resource_id: court.resource_id ?? "",
      resource_name: court.resource_name ?? court.name ?? "",
      slots: Array.isArray(court.slots)
        ? court.slots
            .filter((s: { start_time?: string; duration?: number; price?: number | string; currency?: string }) => !duration || s.duration === duration)
            .map((s: { start_time?: string; duration?: number; price?: number | string; currency?: string }) => {
              const { price, currency } = parsePlaytomicPrice(s.price, s.currency);
              return {
                start_time: s.start_time ?? "",
                duration: s.duration ?? 0,
                price,
                currency,
              };
            })
        : [],
    }));

    return { courts };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { courts: [], error: message };
  }
}

/** Build a Playtomic booking URL for a specific club. */
export function buildPlaytomicUrl(tenantId: string): string {
  return `https://playtomic.io/tenant/${tenantId}`;
}
