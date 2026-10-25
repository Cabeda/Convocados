import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestHandler } from "../../scripts/server-handler.mjs";

const CANONICAL = "https://convocados.cabeda.dev";
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
};

type Reply = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

/** Boots the real wrapper on an ephemeral port. */
async function boot(handler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("handler");
})) {
  const server = http.createServer(
    createRequestHandler({ handler, securityHeaders: SECURITY_HEADERS, canonicalBaseUrl: CANONICAL }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, handler };
}

function request(
  port: number,
  path: string,
  { method = "GET", host = "convocados.fly.dev", body }: { method?: string; host?: string; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: { host } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("production request handler wiring", () => {
  it("redirects a retired-host prerendered path before the Astro handler runs", async () => {
    const { port, handler } = await boot();

    const res = await request(port, "/");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`${CANONICAL}/`);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(handler).not.toHaveBeenCalled();
  });

  it("still sends the security header map on the redirect", async () => {
    const { port } = await boot();

    const res = await request(port, "/docs");

    expect(res.headers["strict-transport-security"]).toBe(SECURITY_HEADERS["Strict-Transport-Security"]);
    expect(res.headers["x-content-type-options"]).toBe(SECURITY_HEADERS["X-Content-Type-Options"]);
  });

  it("lets the canonical host reach the handler, with security headers applied", async () => {
    const { port, handler } = await boot();

    const res = await request(port, "/docs", { host: "convocados.cabeda.dev" });

    expect(res.status).toBe(200);
    expect(res.body).toBe("handler");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.headers["x-content-type-options"]).toBe(SECURITY_HEADERS["X-Content-Type-Options"]);
  });

  it.each([
    ["/.well-known/assetlinks.json"],
    ["/.well-known/apple-app-site-association"],
    ["/api/health"],
  ])("serves %s in place on the retired host", async (path) => {
    const { port, handler } = await boot();

    const res = await request(port, path);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("answers a mutation with 308 and the body drained", async () => {
    const { port, handler } = await boot();

    const res = await request(port, "/api/events", { method: "POST", body: '{"title":"x"}' });

    expect(res.status).toBe(308);
    expect(res.headers.location).toBe(`${CANONICAL}/api/events`);
    expect(handler).not.toHaveBeenCalled();
  });
});
