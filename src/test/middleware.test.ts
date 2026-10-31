import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// defineMiddleware is just an identity wrapper at runtime.
vi.mock("astro:middleware", () => ({
  defineMiddleware: (fn: unknown) => fn,
}));

// The trace line is the whole point of this branch; pin it rather than
// trusting it to stay in an `if` nobody exercises.
vi.mock("~/lib/logger.server", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  return { logger, createLogger: () => logger };
});

import { onRequest } from "~/middleware";
import { logger } from "~/lib/logger.server";

type Handler = (ctx: unknown, next: () => Promise<Response>) => Promise<Response>;
const run = onRequest as unknown as Handler;

function ctx(method: string, urlStr: string, extra: Record<string, unknown> = {}) {
  return { request: new Request(urlStr, { method }), url: new URL(urlStr), ...extra };
}

describe("security middleware", () => {
  it("adds security headers to a normal response", async () => {
    const res = await run(ctx("GET", "https://convocados.cabeda.dev/"), async () =>
      new Response("ok", { status: 200 }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("allows Google avatar images in the CSP img-src", async () => {
    const res = await run(ctx("GET", "https://convocados.cabeda.dev/"), async () =>
      new Response("ok", { status: 200 }),
    );
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const imgSrc = csp.match(/img-src ([^;]+)/)?.[1] ?? "";
    expect(imgSrc).toContain("https://*.googleusercontent.com");
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

  it("never lets the route cache store the host redirect", async () => {
    const set = vi.fn();
    const res = await run(
      ctx("GET", "https://convocados.fly.dev/events/abc?x=1", { cache: { set } }),
      async () => new Response("should not reach", { status: 200 }),
    );
    expect(res.status).toBe(301);
    // The cache is keyed by path, not host: a cached redirect served back to the
    // canonical host points at itself and loops (ERR_TOO_MANY_REDIRECTS).
    expect(set).toHaveBeenCalledWith(false);
    // And the browser must not heuristically cache the 301 either.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sends the security header map on the host redirect too", async () => {
    const res = await run(
      ctx("GET", "https://convocados.fly.dev/events/abc"),
      async () => new Response("should not reach", { status: 200 }),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("Strict-Transport-Security")).toBeTruthy();
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
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

describe("CSRF origin gate on traced routes", () => {
  /** A cookie-bearing cross-origin POST — the shape CSRF protection exists for. */
  function crossOriginPost(url: string) {
    return {
      request: new Request(url, {
        method: "POST",
        headers: {
          cookie: "better-auth.session_token=abc",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
          "content-type": "text/plain",
        },
        body: "{}",
      }),
      url: new URL(url),
    };
  }

  it("blocks a cookie-bearing cross-origin POST to /api/mcp before it reaches the handler", async () => {
    const next = vi.fn(async () => new Response("handled", { status: 200 }));
    const res = await run(crossOriginPost("https://convocados.cabeda.dev/api/mcp"), next);
    expect(res.status).toBe(403);
    // /api/mcp is traced; the trace must never be a way around the gate.
    expect(next).not.toHaveBeenCalled();
  });

  it("still blocks the same request on a non-traced route", async () => {
    const next = vi.fn(async () => new Response("handled", { status: 200 }));
    const res = await run(crossOriginPost("https://convocados.cabeda.dev/api/events"), next);
    expect(res.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("lets a same-origin POST to /api/mcp through and logs the trace", async () => {
    vi.mocked(logger.info).mockClear();
    const next = vi.fn(async () => new Response("handled", { status: 200 }));
    const res = await run(
      {
        request: new Request("https://convocados.cabeda.dev/api/mcp", {
          method: "POST",
          headers: { cookie: "better-auth.session_token=abc", origin: "https://convocados.cabeda.dev" },
          body: "{}",
        }),
        url: new URL("https://convocados.cabeda.dev/api/mcp"),
      },
      next,
    );
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
    // The diagnostic itself must exist: path, status and the credential kind
    // (a session cookie still authenticates this endpoint).
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/api/mcp", status: 200, auth: "cookie" }),
      "oauth/mcp request",
    );
  });

  it("logs the blocked cross-origin attempt too, with its status", async () => {
    vi.mocked(logger.info).mockClear();
    const res = await run(crossOriginPost("https://convocados.cabeda.dev/api/mcp"), async () =>
      new Response("handled", { status: 200 }),
    );
    expect(res.status).toBe(403);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/api/mcp", status: 403 }),
      "oauth/mcp request",
    );
  });

  it("does not trace unrelated routes", async () => {
    vi.mocked(logger.info).mockClear();
    await run(ctx("GET", "https://convocados.cabeda.dev/api/events"), async () =>
      new Response("ok", { status: 200 }),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("lets a bearer-authenticated cross-origin POST to /api/mcp through", async () => {
    const next = vi.fn(async () => new Response("handled", { status: 200 }));
    const res = await run(
      {
        request: new Request("https://convocados.cabeda.dev/api/mcp", {
          method: "POST",
          headers: {
            cookie: "better-auth.session_token=abc",
            origin: "https://evil.example",
            authorization: "Bearer token",
          },
          body: "{}",
        }),
        url: new URL("https://convocados.cabeda.dev/api/mcp"),
      },
      next,
    );
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });
});
