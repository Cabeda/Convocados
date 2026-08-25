// Server-side geocoding utility.
// Parses coordinates from Google Maps URLs, raw "lat,lng" strings,
// or falls back to Nominatim for free-text addresses.

export interface GeoResult {
  latitude: number;
  longitude: number;
  /** Human-readable place name. Only set when the input was a Google Maps link. */
  name?: string;
}

// Google Maps URL patterns:
// https://www.google.com/maps/place/.../@41.1579,-8.6291,...
// https://www.google.com/maps?q=41.1579,-8.6291
// https://maps.google.com/?ll=41.1579,-8.6291
// https://goo.gl/maps/... (short links — resolved via redirect)
// https://maps.app.goo.gl/... (short links — resolved via redirect)

const MAPS_AT_REGEX = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
const MAPS_Q_REGEX = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/;
// Share links use ?query=lat,lng (e.g. /maps/search/?api=1&query=...)
const MAPS_QUERY_REGEX = /[?&]query=(-?\d+\.\d+),(-?\d+\.\d+)/;
const MAPS_LL_REGEX = /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/;
// Google Maps encodes the actual place location as !3d<lat>!4d<lng> in the data parameter
const MAPS_3D4D_REGEX = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
const RAW_COORDS_REGEX = /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/;

function parseCoords(lat: string, lng: string): GeoResult | null {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  if (isNaN(latitude) || isNaN(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/** Try to extract coordinates from a Google Maps URL. Prefers the actual place pin (!3d/!4d) over the viewport center (@). */
export function parseMapsUrl(url: string): GeoResult | null {
  // 1. Prefer !3d/!4d — these are the actual place coordinates
  const placeMatch = url.match(MAPS_3D4D_REGEX);
  if (placeMatch) {
    const result = parseCoords(placeMatch[1], placeMatch[2]);
    if (result) return result;
  }

  // 2. Fall back to other patterns (q=, query=, ll=, @)
  for (const regex of [MAPS_Q_REGEX, MAPS_QUERY_REGEX, MAPS_LL_REGEX, MAPS_AT_REGEX]) {
    const match = url.match(regex);
    if (match) return parseCoords(match[1], match[2]);
  }
  return null;
}

/** Extract a human-readable place name from a Google Maps URL (/maps/place/<name>/...). */
export function parsePlaceNameFromMapsUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const i = segments.indexOf("place");
    if (i === -1 || !segments[i + 1]) return null;
    return decodeURIComponent(segments[i + 1].replace(/\+/g, " ")) || null;
  } catch {
    return null;
  }
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

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

/** Reverse-geocode coordinates to a place name via Nominatim (free OSM service). */
async function reverseGeocodeName(latitude: number, longitude: number): Promise<string | null> {
  try {
    const res = await fetch(`${NOMINATIM_REVERSE_URL}?lat=${latitude}&lon=${longitude}&format=jsonv2&zoom=17`, {
      headers: {
        "User-Agent": "Convocados/1.0",
        "Accept-Language": "en",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== "object") return null;
    if (typeof data.name === "string" && data.name.trim()) return data.name.trim();
    if (typeof data.display_name === "string") {
      return data.display_name.split(",")[0]?.trim() || null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Attach the place name for maps-link inputs: parse from URL path, else reverse geocode. */
async function withMapsLinkName(url: string, coords: GeoResult): Promise<GeoResult> {
  const parsedName = parsePlaceNameFromMapsUrl(url);
  if (parsedName) return { ...coords, name: parsedName };
  const reverseName = await reverseGeocodeName(coords.latitude, coords.longitude);
  return reverseName ? { ...coords, name: reverseName } : coords;
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
 * Resolve location text to coordinates (plus place name for Google Maps links).
 * Tries in order: Google Maps short URL → Google Maps URL → raw coords → Nominatim geocoding.
 * Returns null if nothing works.
 */
export async function resolveLocation(location: string): Promise<GeoResult | null> {
  if (!location.trim()) return null;

  // 1. Short Google Maps links — resolve redirect first
  if (/goo\.gl\/maps|maps\.app\.goo/i.test(location)) {
    const fullUrl = await resolveShortUrl(location);
    if (fullUrl && /google\.com\/maps|maps\.google/i.test(fullUrl)) {
      const result = parseMapsUrl(fullUrl);
      if (result) return withMapsLinkName(fullUrl, result);
    }
  }

  // 2. Full Google Maps URL
  if (/google\.com\/maps|maps\.google/i.test(location)) {
    const result = parseMapsUrl(location);
    if (result) return withMapsLinkName(location, result);
  }

  // 3. Raw coordinates
  const raw = parseRawCoords(location);
  if (raw) return raw;

  // 4. Nominatim fallback
  return geocodeAddress(location);
}
