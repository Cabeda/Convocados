import { describe, it, expect } from "vitest";
import { parseMapsUrl, parseRawCoords } from "~/lib/geocode";

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
