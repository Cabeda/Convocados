import { describe, it, expect } from "vitest";
import { canonicalHostRedirect } from "../../scripts/canonical-host.mjs";

type Req = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
};

function req(overrides: Req = {}): Req {
  return {
    method: "GET",
    url: "/events/abc?x=1",
    headers: { "x-forwarded-host": "convocados.fly.dev", "x-forwarded-proto": "https" },
    ...overrides,
  };
}

const CANONICAL = "https://convocados.cabeda.dev";

describe("canonicalHostRedirect (HTTP layer)", () => {
  it("301s a GET on the retired host to the canonical host, preserving path + query", () => {
    expect(canonicalHostRedirect(req(), CANONICAL)).toEqual({
      status: 301,
      location: "https://convocados.cabeda.dev/events/abc?x=1",
      cacheControl: "no-store",
    });
  });

  it("marks the redirect no-store so browsers cannot pin the old host", () => {
    expect(canonicalHostRedirect(req(), CANONICAL)?.cacheControl).toBe("no-store");
  });

  it("redirects prerendered/static paths too, which never reach Astro middleware", () => {
    expect(canonicalHostRedirect(req({ url: "/docs/api" }), CANONICAL)?.status).toBe(301);
    expect(canonicalHostRedirect(req({ url: "/_astro/app.css" }), CANONICAL)?.status).toBe(301);
  });

  it("uses 308 for mutations so the method and body survive", () => {
    expect(canonicalHostRedirect(req({ method: "POST" }), CANONICAL)?.status).toBe(308);
  });

  it("does nothing on the canonical host", () => {
    expect(
      canonicalHostRedirect(req({ headers: { "x-forwarded-host": "convocados.cabeda.dev" } }), CANONICAL),
    ).toBeNull();
  });

  it("does nothing when x-forwarded-host is absent but Host is canonical", () => {
    expect(
      canonicalHostRedirect(req({ headers: { host: "convocados.cabeda.dev" } }), CANONICAL),
    ).toBeNull();
  });

  it("takes the public host from x-forwarded-host, not the internal Host", () => {
    const r = canonicalHostRedirect(
      req({ headers: { host: "localhost:3000", "x-forwarded-host": "convocados.fly.dev" } }),
      CANONICAL,
    );
    expect(r?.location).toBe("https://convocados.cabeda.dev/events/abc?x=1");
  });

  it("never redirects localhost (dev) or the internal proxy address", () => {
    expect(canonicalHostRedirect(req({ headers: { host: "localhost:4321" } }), "http://localhost:4321")).toBeNull();
    expect(canonicalHostRedirect(req({ headers: { host: "127.0.0.1:3000" } }), CANONICAL)).toBeNull();
  });

  it("does nothing when BETTER_AUTH_URL is missing or unparseable", () => {
    expect(canonicalHostRedirect(req(), undefined)).toBeNull();
    expect(canonicalHostRedirect(req(), "not a url")).toBeNull();
  });

  it("never redirects the Fly health check", () => {
    expect(canonicalHostRedirect(req({ url: "/api/health" }), CANONICAL)).toBeNull();
    expect(canonicalHostRedirect(req({ url: "/api/health?full=1" }), CANONICAL)).toBeNull();
  });

  it("keeps the path on the canonical host even for a protocol-relative URL", () => {
    expect(canonicalHostRedirect(req({ url: "//evil.example/x" }), CANONICAL)?.location).toBe(
      "https://convocados.cabeda.dev/x",
    );
  });
});
