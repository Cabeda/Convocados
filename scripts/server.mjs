#!/usr/bin/env node
/**
 * Production server wrapper.
 *
 * Astro's node adapter serves prerendered pages as static files, which bypass
 * Astro middleware, so those responses had no security headers (no CSP, HSTS,
 * X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
 * on exactly the pages that need them — sign-in, sign-up, dashboard.
 *
 * The adapter's `staticHeaders` option cannot fix that here: it resolves
 * `_headers.json` against the build-time output directory baked into the
 * manifest, so the path only exists on the CI runner, never in the image.
 * Injecting at the HTTP layer is independent of build paths.
 *
 * The header map is emitted at build time by
 * `src/integrations/staticSecurityHeaders.ts`, which shares its source of truth
 * with the middleware (`src/lib/securityHeaders.ts`) used for dynamic routes.
 */
import fs from "node:fs";
import http from "node:http";

// Must be set before the Astro entry is imported, otherwise it starts its own
// server and this wrapper never sees the requests.
process.env.ASTRO_NODE_AUTOSTART = "disabled";

const headersFile = new URL("../dist/security-headers.json", import.meta.url);
const securityHeaders = fs.existsSync(headersFile)
  ? JSON.parse(fs.readFileSync(headersFile, "utf8"))
  : {};

const { handler } = await import(
  new URL("../dist/server/entry.mjs", import.meta.url).href
);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const server = http.createServer((req, res) => {
  // Node routes both explicit res.writeHead() and the implicit header flush in
  // res.end() through this method, so overriding it covers every response —
  // static files, SSR pages and API routes alike.
  const writeHead = res.writeHead.bind(res);
  res.writeHead = (...args) => {
    for (const [key, value] of Object.entries(securityHeaders)) {
      if (!res.hasHeader(key)) res.setHeader(key, value);
    }
    return writeHead(...args);
  };
  handler(req, res);
});

server.listen(port, host, () => {
  console.log(
    `[server] listening on http://${host}:${port} ` +
      `(${Object.keys(securityHeaders).length} security headers)`,
  );
});
