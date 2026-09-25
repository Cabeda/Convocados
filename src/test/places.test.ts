import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  classifyPlace,
  rankPlaceSuggestions,
  searchPlaces,
  reversePlaceName,
  type PhotonFeature,
} from "~/lib/places.server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function feature(props: Record<string, unknown>, coords: [number, number] = [-8.6, 41.1]): PhotonFeature {
  return { properties: props, geometry: { coordinates: coords } };
}

describe("classifyPlace", () => {
  it("flags pitches, sports centres and stadiums as sport", () => {
    expect(classifyPlace(feature({ name: "Pitch", leisure: "pitch" }))).toBe(true);
    expect(classifyPlace(feature({ name: "Centre", leisure: "sports_centre" }))).toBe(true);
    expect(classifyPlace(feature({ name: "Stadium", leisure: "stadium" }))).toBe(true);
    expect(classifyPlace(feature({ name: "Club", sport: "soccer" }))).toBe(true);
  });

  it("does not flag restaurants, cafes or shops as sport", () => {
    expect(classifyPlace(feature({ name: "Bistro", amenity: "restaurant" }))).toBe(false);
    expect(classifyPlace(feature({ name: "Cafe", amenity: "cafe" }))).toBe(false);
    expect(classifyPlace(feature({ name: "Shop", shop: "supermarket" }))).toBe(false);
  });
});

describe("rankPlaceSuggestions", () => {
  it("puts sports venues ahead of unrelated amenities", () => {
    const raw = [
      feature({ name: "Pizzeria", amenity: "restaurant" }, [-8.61, 41.11]),
      feature({ name: "Campo de Futebol", leisure: "pitch" }, [-8.62, 41.12]),
      feature({ name: "Cafe", amenity: "cafe" }, [-8.63, 41.13]),
    ];

    const ranked = rankPlaceSuggestions(raw);
    expect(ranked[0].name).toBe("Campo de Futebol");
    expect(ranked[0].isSport).toBe(true);
  });

  it("keeps non-sport results after sport ones without dropping them", () => {
    const raw = [
      feature({ name: "Pizzeria", amenity: "restaurant" }),
      feature({ name: "Pitch", leisure: "pitch" }),
    ];
    const ranked = rankPlaceSuggestions(raw);
    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.name)).toEqual(["Pitch", "Pizzeria"]);
  });

  it("builds a readable label from name, street, city and country", () => {
    const ranked = rankPlaceSuggestions([
      feature({ name: "Campo", street: "Rua A", city: "Porto", country: "Portugal" }),
    ]);
    expect(ranked[0].label).toBe("Campo, Rua A, Porto, Portugal");
    expect(ranked[0].latitude).toBe(41.1);
    expect(ranked[0].longitude).toBe(-8.6);
  });

  it("skips features with no usable label", () => {
    expect(rankPlaceSuggestions([feature({})])).toEqual([]);
  });
});

describe("searchPlaces", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns [] for queries shorter than 2 chars without calling the network", async () => {
    const results = await searchPlaces("a");
    expect(results).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps Photon features to ranked suggestions", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          feature({ name: "Restaurante", amenity: "restaurant" }),
          feature({ name: "Padel Club", leisure: "sports_centre" }),
        ],
      }),
    });

    const results = await searchPlaces("padel lisboa");
    expect(results[0].name).toBe("Padel Club");
    expect(results[0].isSport).toBe(true);
  });

  it("returns [] when the upstream request fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await searchPlaces("porto")).toEqual([]);
  });

  it("sends bias coordinates so nearby places rank first", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    await searchPlaces("padel", { bias: { latitude: 41.1, longitude: -8.6 } });
    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("lat=41.1");
    expect(calledUrl).toContain("lon=-8.6");
  });
});

describe("reversePlaceName", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("prefers the named place over the full display name", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ name: "Campo da Areosa", display_name: "Campo da Areosa, Rua X, Porto, Portugal" }),
    });
    expect(await reversePlaceName(41.1, -8.6)).toBe("Campo da Areosa");
  });

  it("falls back to the first display_name segment", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: "Rua X, Porto, Portugal" }),
    });
    expect(await reversePlaceName(41.1, -8.6)).toBe("Rua X");
  });

  it("returns null on failure so callers can keep the coordinates", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    expect(await reversePlaceName(41.1, -8.6)).toBeNull();
  });
});
