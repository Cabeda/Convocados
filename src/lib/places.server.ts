// Free, key-less place search for the location pickers (web + Android).
//
// Search is served by Photon (komoot) and reverse geocoding by Nominatim — both
// OpenStreetMap-backed and free, so no Google billing is involved. Results are
// re-ranked so sports facilities (pitches, courts, sports centres, stadiums)
// surface ahead of unrelated amenities with the same name, which is what a
// pickup-game organiser actually wants.
//
// Third-party usage policy: callers must debounce. The API route proxies these
// calls so the app never hits Photon/Nominatim directly.

export const PHOTON_URL = process.env.PHOTON_URL ?? "https://photon.komoot.io";
export const NOMINATIM_URL = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";

const USER_AGENT = "Convocados/1.0 (+https://convocados.cabeda.dev)";

export interface PhotonFeature {
  properties: {
    name?: string;
    street?: string;
    city?: string;
    country?: string;
    leisure?: string;
    sport?: string;
    amenity?: string;
    osm_key?: string;
    osm_value?: string;
  };
  geometry: { coordinates: [number, number] };
}

export interface PlaceSuggestion {
  /** Human-readable, already assembled for display + storing in the field. */
  label: string;
  /** The bare place name (preferred when writing back to the location box). */
  name: string;
  latitude: number;
  longitude: number;
  /** True for pitches, courts, sports centres, stadiums and sport-tagged places. */
  isSport: boolean;
}

const SPORT_LEISURE = new Set([
  "pitch",
  "sports_centre",
  "stadium",
  "track",
  "golf_course",
  "fitness_centre",
  "swimming_pool",
  "water_park",
  "ice_rink",
]);

/** Whether a Photon feature looks like a place you'd actually play sport at. */
export function classifyPlace(feature: PhotonFeature): boolean {
  const p = feature.properties ?? {};
  if (p.sport) return true;
  if (p.leisure && SPORT_LEISURE.has(p.leisure)) return true;
  if (p.osm_key === "sport") return true;
  if (p.osm_key === "leisure" && p.osm_value && SPORT_LEISURE.has(p.osm_value)) return true;
  return false;
}

function primaryName(feature: PhotonFeature): string {
  const p = feature.properties ?? {};
  if (p.name?.trim()) return p.name.trim();
  if (p.street?.trim()) return p.street.trim();
  if (p.city?.trim()) return p.city.trim();
  return "";
}

function buildLabel(p: Partial<PhotonFeature["properties"]>): string {
  return [p.name, p.street, p.city, p.country]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(", ");
}

/** Map raw Photon features to suggestions, sports first, stable within each group. */
export function rankPlaceSuggestions(raw: PhotonFeature[]): PlaceSuggestion[] {
  const mapped: PlaceSuggestion[] = [];
  for (const feature of raw) {
    const name = primaryName(feature);
    if (!name) continue;
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    mapped.push({
      label: buildLabel(feature.properties as PhotonFeature["properties"]) || name,
      name,
      latitude: coords[1],
      longitude: coords[0],
      isSport: classifyPlace(feature),
    });
  }
  // Stable sort: sports first, otherwise keep the upstream relevance order.
  return mapped
    .map((s, i) => ({ s, i }))
    .sort((a, b) => Number(b.s.isSport) - Number(a.s.isSport) || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * Search places by free text. Queries under 2 characters return immediately —
 * both to avoid useless upstream calls and to respect Photon's usage policy.
 *
 * When `bias` coordinates are supplied, Photon ranks results near that point
 * first, so "campo de futebol" offers the local pitch before one in Brazil.
 */
export async function searchPlaces(
  query: string,
  opts: { limit?: number; bias?: { latitude: number; longitude: number } } = {},
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const limit = opts.limit ?? 8;

  const params = new URLSearchParams({ q, limit: String(limit), lang: "en" });
  if (opts.bias) {
    params.set("lat", String(opts.bias.latitude));
    params.set("lon", String(opts.bias.longitude));
  }

  try {
    const res = await fetch(`${PHOTON_URL}/api/?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const features: PhotonFeature[] = Array.isArray(data?.features) ? data.features : [];
    return rankPlaceSuggestions(features);
  } catch {
    return [];
  }
}

/** Reverse-geocode a pin to a friendly place name. Null when unavailable. */
export async function reversePlaceName(latitude: number, longitude: number): Promise<string | null> {
  try {
    const res = await fetch(
      `${NOMINATIM_URL}/reverse?lat=${latitude}&lon=${longitude}&format=jsonv2&zoom=17`,
      { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.name === "string" && data.name.trim()) return data.name.trim();
    if (typeof data?.display_name === "string") {
      return data.display_name.split(",")[0]?.trim() || null;
    }
    return null;
  } catch {
    return null;
  }
}
