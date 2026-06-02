import { describe, it, expect, vi } from "vitest";

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
