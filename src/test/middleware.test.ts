import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// defineMiddleware is just an identity wrapper at runtime.
vi.mock("astro:middleware", () => ({
  defineMiddleware: (fn: unknown) => fn,
}));

import { onRequest } from "~/middleware";

type Handler = (ctx: unknown, next: () => Promise<Response>) => Promise<Response>;
const run = onRequest as unknown as Handler;

function ctx(method: string, urlStr: string) {
  return { request: new Request(urlStr, { method }), url: new URL(urlStr) };
}

describe("security middleware", () => {
  it("adds security headers to a normal response", async () => {
    const res = await run(ctx("GET", "https://convocados.cabeda.dev/"), async () =>
      new Response("ok", { status: 200 }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("does not throw on redirect responses with immutable headers", async () => {
    const res = await run(
      ctx("GET", "https://convocados.cabeda.dev/api/auth/mobile-callback"),
      async () => Response.redirect("https://convocados.cabeda.dev/auth/signin", 302),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://convocados.cabeda.dev/auth/signin");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("canonical host redirect", () => {
  const ORIGINAL = process.env.BETTER_AUTH_URL;
  beforeEach(() => { process.env.BETTER_AUTH_URL = "https://convocados.cabeda.dev"; });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = ORIGINAL;
  });

  it("301-redirects a non-canonical host to the canonical host, preserving path + query", async () => {
    const res = await run(
      ctx("GET", "https://convocados.fly.dev/events/abc?x=1"),
      async () => new Response("should not reach", { status: 200 }),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://convocados.cabeda.dev/events/abc?x=1");
  });

  it("does NOT redirect when already on the canonical host", async () => {
    const res = await run(
      ctx("GET", "https://convocados.cabeda.dev/events/abc"),
      async () => new Response("ok", { status: 200 }),
    );
    expect(res.status).toBe(200);
  });

  it("redirects non-GET methods to the canonical host too (308 to preserve method)", async () => {
    const res = await run(
      ctx("POST", "https://convocados.fly.dev/api/events/abc/rsvp"),
      async () => new Response("should not reach", { status: 200 }),
    );
    // 308 preserves the POST method + body on redirect
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://convocados.cabeda.dev/api/events/abc/rsvp");
  });

  it("does not redirect localhost (dev) even if it isn't the canonical host", async () => {
    const res = await run(
      ctx("GET", "http://localhost:4321/events/abc"),
      async () => new Response("ok", { status: 200 }),
    );
    expect(res.status).toBe(200);
  });

  it("never redirects /api/health (Fly health check hits it with a non-public host)", async () => {
    const res = await run(
      ctx("GET", "https://convocados.fly.dev/api/health"),
      async () => new Response('{"status":"ok"}', { status: 200 }),
    );
    expect(res.status).toBe(200);
  });
});
