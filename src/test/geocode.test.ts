import { describe, it, expect, vi, afterEach } from "vitest";
import { parseMapsUrl, parsePlaceNameFromMapsUrl, parseRawCoords, resolveLocation } from "~/lib/geocode";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseMapsUrl", () => {
  it("extracts coords from @lat,lng pattern", () => {
    const result = parseMapsUrl("https://www.google.com/maps/place/Porto/@41.1579,-8.6291,12z");
    expect(result).toEqual({ latitude: 41.1579, longitude: -8.6291 });
  });

  it("extracts coords from ?q=lat,lng pattern", () => {
    const result = parseMapsUrl("https://www.google.com/maps?q=38.7223,-9.1393");
    expect(result).toEqual({ latitude: 38.7223, longitude: -9.1393 });
  });

  it("extracts coords from ?ll=lat,lng pattern", () => {
    const result = parseMapsUrl("https://maps.google.com/?ll=51.5074,-0.1278");
    expect(result).toEqual({ latitude: 51.5074, longitude: -0.1278 });
  });

  it("prefers !3d/!4d place coords over @viewport coords", () => {
    const url = "https://www.google.com/maps/place/Campo+futebol/@41.1772491,-8.6252575,3773m/data=!3m1!1e3!4m6!3m5!1s0xd2465820053beb1:0x10038bef150a8c06!8m2!3d41.1731144!4d-8.6197766!16s%2Fg%2F11jclfdxbl";
    const result = parseMapsUrl(url);
    expect(result).toEqual({ latitude: 41.1731144, longitude: -8.6197766 });
  });

  it("returns null for non-maps URL", () => {
    expect(parseMapsUrl("https://example.com")).toBeNull();
  });

  it("returns null for maps URL without coords", () => {
    expect(parseMapsUrl("https://www.google.com/maps/place/Porto")).toBeNull();
  });

  it("handles negative coordinates", () => {
    const result = parseMapsUrl("https://www.google.com/maps/place/Test/@-33.8688,151.2093,12z");
    expect(result).toEqual({ latitude: -33.8688, longitude: 151.2093 });
  });

  it("rejects out-of-range latitude", () => {
    expect(parseMapsUrl("https://www.google.com/maps?q=91.0,0.0")).toBeNull();
  });

  it("rejects out-of-range longitude", () => {
    expect(parseMapsUrl("https://www.google.com/maps?q=0.0,181.0")).toBeNull();
  });
});

describe("parseRawCoords", () => {
  it("parses 'lat,lng' string", () => {
    expect(parseRawCoords("41.1579,-8.6291")).toEqual({ latitude: 41.1579, longitude: -8.6291 });
  });

  it("parses with spaces around comma", () => {
    expect(parseRawCoords("41.1579 , -8.6291")).toEqual({ latitude: 41.1579, longitude: -8.6291 });
  });

  it("parses integers", () => {
    expect(parseRawCoords("41,-8")).toEqual({ latitude: 41, longitude: -8 });
  });

  it("returns null for plain text", () => {
    expect(parseRawCoords("Porto, Portugal")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRawCoords("")).toBeNull();
  });

  it("returns null for single number", () => {
    expect(parseRawCoords("41.1579")).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(parseRawCoords("91,0")).toBeNull();
    expect(parseRawCoords("0,181")).toBeNull();
  });
});

describe("parsePlaceNameFromMapsUrl", () => {
  it("extracts place name from a resolved maps URL", () => {
    const url = "https://www.google.com/maps/place/Campo+futebol+Nun'Alvares/@41.1731142,-8.6300682,5003m/data=!3m1!1e3!4m6!3m5!1s0xd2465820053beb1:0x10038bef150a8c06!8m2!3d41.1731144!4d-8.6197766!16s%2Fg%2F11jclfdxbl";
    expect(parsePlaceNameFromMapsUrl(url)).toBe("Campo futebol Nun'Alvares");
  });

  it("decodes percent-encoded characters", () => {
    const url = "https://www.google.com/maps/place/S%C3%A3o%20Bento/@41.1,-8.6";
    expect(parsePlaceNameFromMapsUrl(url)).toBe("São Bento");
  });

  it("returns null for coordinate-only URLs", () => {
    expect(
      parsePlaceNameFromMapsUrl("https://www.google.com/maps/search/?api=1&query=41.1579,-8.6291"),
    ).toBeNull();
  });

  it("returns null for URLs without a place segment", () => {
    expect(parsePlaceNameFromMapsUrl("https://www.google.com/maps?q=41.1579,-8.6291")).toBeNull();
    expect(parsePlaceNameFromMapsUrl("https://example.com")).toBeNull();
  });
});

describe("resolveLocation", () => {
  it("returns null for empty string", async () => {
    expect(await resolveLocation("")).toBeNull();
    expect(await resolveLocation("   ")).toBeNull();
  });

  it("resolves raw coordinates", async () => {
    const result = await resolveLocation("41.1579,-8.6291");
    expect(result).toEqual({ latitude: 41.1579, longitude: -8.6291 });
  });

  it("resolves full Google Maps URL", async () => {
    const result = await resolveLocation("https://www.google.com/maps/place/Porto/@41.1579,-8.6291,12z");
    expect(result).toEqual({ latitude: 41.1579, longitude: -8.6291, name: "Porto" });
  });

  it("returns null for short URL when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    const result = await resolveLocation("https://goo.gl/maps/abc123");
    // Falls through to Nominatim which also fails in test
    expect(result).toBeNull();
  });

  it("resolves short URL when redirect contains coords", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("goo.gl")) {
        return new Response(null, {
          status: 301,
          headers: { location: "https://www.google.com/maps/place/Test/@38.7223,-9.1393,12z" },
        });
      }
      // Nominatim fallback — return empty
      return new Response("[]", { status: 200 });
    });
    const result = await resolveLocation("https://goo.gl/maps/abc123");
    expect(result).toEqual({ latitude: 38.7223, longitude: -9.1393, name: "Test" });
  });

  it("extracts place name from a full maps place URL", async () => {
    const result = await resolveLocation(
      "https://www.google.com/maps/place/Campo+futebol+Nun'Alvares/@41.1579,-8.6291,12z",
    );
    expect(result).toEqual({ latitude: 41.1579, longitude: -8.6291, name: "Campo futebol Nun'Alvares" });
  });

  it("reverse geocodes a name for coordinate-only maps links", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("goo.gl")) {
        return new Response(null, {
          status: 301,
          headers: { location: "https://www.google.com/maps/search/?api=1&query=38.7223,-9.1393" },
        });
      }
      if (urlStr.includes("/reverse")) {
        return new Response(JSON.stringify({ name: "Praça do Município", display_name: "Praça do Município, Lisboa, Portugal" }), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    });
    const result = await resolveLocation("https://maps.app.goo.gl/xyz789");
    expect(result).toEqual({ latitude: 38.7223, longitude: -9.1393, name: "Praça do Município" });
  });

  it("does not add a name for raw coordinate input", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await resolveLocation("41.1579,-8.6291");
    expect(result).toEqual({ latitude: 41.1579, longitude: -8.6291 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not add a name for plain text addresses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ lat: "41.1579", lon: "-8.6291" }]), { status: 200 }),
    );
    const result = await resolveLocation("Porto, Portugal");
    expect(result).toEqual({ latitude: 41.1579, longitude: -8.6291 });
  });

  it("falls through to Nominatim for plain text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ lat: "41.1579", lon: "-8.6291" }]), { status: 200 }),
    );
    const result = await resolveLocation("Porto, Portugal");
    expect(result).toEqual({ latitude: 41.1579, longitude: -8.6291 });
  });

  it("returns null when Nominatim returns empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200 }),
    );
    const result = await resolveLocation("xyznonexistent12345");
    expect(result).toBeNull();
  });

  it("returns null when Nominatim fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    const result = await resolveLocation("Some Address");
    expect(result).toBeNull();
  });
});
