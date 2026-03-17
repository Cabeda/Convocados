// Server-side geocoding utility.
// Parses coordinates from Google Maps URLs, raw "lat,lng" strings,
// or falls back to Nominatim for free-text addresses.

export interface GeoResult {
  latitude: number;
  longitude: number;
}

// Google Maps URL patterns:
// https://www.google.com/maps/place/.../@41.1579,-8.6291,...
// https://www.google.com/maps?q=41.1579,-8.6291
// https://maps.google.com/?ll=41.1579,-8.6291
// https://goo.gl/maps/... (short links — not resolved here)
// https://maps.app.goo.gl/... (short links — not resolved here)

const MAPS_AT_REGEX = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
const MAPS_Q_REGEX = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/;
const MAPS_LL_REGEX = /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/;
const RAW_COORDS_REGEX = /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/;

function parseCoords(lat: string, lng: string): GeoResult | null {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  if (isNaN(latitude) || isNaN(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/** Try to extract coordinates from a Google Maps URL. */
export function parseMapsUrl(url: string): GeoResult | null {
  for (const regex of [MAPS_AT_REGEX, MAPS_Q_REGEX, MAPS_LL_REGEX]) {
    const match = url.match(regex);
    if (match) return parseCoords(match[1], match[2]);
  }
  return null;
}

/** Try to parse raw "lat,lng" string. */
export function parseRawCoords(text: string): GeoResult | null {
  const match = text.trim().match(RAW_COORDS_REGEX);
  if (!match) return null;
  return parseCoords(match[1], match[2]);
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** Geocode a free-text address via Nominatim. Tries the full query first, then progressively simpler versions. */
export async function geocodeAddress(address: string): Promise<GeoResult | null> {
  if (!address.trim()) return null;

  // Try the full address first, then progressively drop leading words
  // e.g. "Matosinhos Sports and Events Center" → "Sports and Events Center" → "Events Center"
  const words = address.trim().split(/\s+/);
  const attempts = [address.trim()];
  // Add progressively shorter versions (drop from the start, keep at least 2 words)
  for (let i = 1; i < words.length - 1; i++) {
    attempts.push(words.slice(i).join(" "));
  }

  for (const query of attempts) {
    const result = await nominatimSearch(query);
    if (result) return result;
  }
  return null;
}

async function nominatimSearch(query: string): Promise<GeoResult | null> {
  try {
    const res = await fetch(
      `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`,
      {
        headers: {
          "User-Agent": "Convocados/1.0",
          "Accept-Language": "en",
        },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return parseCoords(data[0].lat, data[0].lon);
  } catch {
    return null;
  }
}

/** Follow a short URL redirect (e.g. goo.gl/maps, maps.app.goo.gl) to get the full URL. */
async function resolveShortUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    const location = res.headers.get("location");
    return location || null;
  } catch {
    return null;
  }
}

/**
 * Resolve location text to coordinates.
 * Tries in order: Google Maps short URL → Google Maps URL → raw coords → Nominatim geocoding.
 * Returns null if nothing works.
 */
export async function resolveLocation(location: string): Promise<GeoResult | null> {
  if (!location.trim()) return null;

  // 1. Short Google Maps links — resolve redirect first
  if (/goo\.gl\/maps|maps\.app\.goo/i.test(location)) {
    const fullUrl = await resolveShortUrl(location);
    if (fullUrl) {
      const result = parseMapsUrl(fullUrl);
      if (result) return result;
    }
  }

  // 2. Full Google Maps URL
  if (/google\.com\/maps|maps\.google/i.test(location)) {
    const result = parseMapsUrl(location);
    if (result) return result;
  }

  // 3. Raw coordinates
  const raw = parseRawCoords(location);
  if (raw) return raw;

  // 4. Nominatim fallback
  return geocodeAddress(location);
}
