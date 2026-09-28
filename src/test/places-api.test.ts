import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET as placesGet } from "~/pages/api/places";
import { searchPlaces, reversePlaceName } from "~/lib/places.server";
import { getSession } from "~/lib/auth.helpers.server";

vi.mock("~/lib/auth.helpers.server", () => ({ getSession: vi.fn() }));
vi.mock("~/lib/places.server", () => ({
  searchPlaces: vi.fn(),
  reversePlaceName: vi.fn(),
}));

const mockedGetSession = vi.mocked(getSession);
const mockedSearch = vi.mocked(searchPlaces);
const mockedReverse = vi.mocked(reversePlaceName);

function ctx(url: string) {
  return { request: new Request(url) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSession.mockResolvedValue({ user: { id: "u1" } } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/places", () => {
  it("requires authentication", async () => {
    mockedGetSession.mockResolvedValue(null as never);
    const res = await placesGet(ctx("https://x.dev/api/places?q=porto"));
    expect(res.status).toBe(401);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("returns ranked suggestions for a query", async () => {
    mockedSearch.mockResolvedValue([
      { label: "Padel Club, Porto", name: "Padel Club", latitude: 41.1, longitude: -8.6, isSport: true },
    ]);
    const res = await placesGet(ctx("https://x.dev/api/places?q=padel+porto"));
    const body = await res.json();
    expect(mockedSearch).toHaveBeenCalledWith("padel porto");
    expect(body.suggestions[0].name).toBe("Padel Club");
  });

  it("returns an empty list when no query is given", async () => {
    const res = await placesGet(ctx("https://x.dev/api/places"));
    const body = await res.json();
    expect(body.suggestions).toEqual([]);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("reverse-geocodes when lat/lng are supplied", async () => {
    mockedReverse.mockResolvedValue("Campo da Areosa");
    const res = await placesGet(ctx("https://x.dev/api/places?lat=41.1&lng=-8.6"));
    const body = await res.json();
    expect(mockedReverse).toHaveBeenCalledWith(41.1, -8.6);
    expect(body.name).toBe("Campo da Areosa");
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("rejects non-numeric coordinates", async () => {
    const res = await placesGet(ctx("https://x.dev/api/places?lat=abc&lng=-8.6"));
    expect(res.status).toBe(400);
    expect(mockedReverse).not.toHaveBeenCalled();
  });

  it("biases search toward the caller when a query and coords are both present", async () => {
    mockedSearch.mockResolvedValue([]);
    await placesGet(ctx("https://x.dev/api/places?q=padel&lat=41.1&lng=-8.6"));
    expect(mockedSearch).toHaveBeenCalledWith("padel", { bias: { latitude: 41.1, longitude: -8.6 } });
    expect(mockedReverse).not.toHaveBeenCalled();
  });
});
