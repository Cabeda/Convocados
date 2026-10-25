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
 * The same layer decides the canonical-host redirect: Astro middleware never
 * sees prerendered pages, static files or route-cache hits, so a request to the
 * retired `convocados.fly.dev` host could be answered with that host as its
 * origin. `createRequestHandler` redirects every request instead, before Astro.
 *
 * The header map is emitted at build time by
 * `src/integrations/staticSecurityHeaders.ts`, which shares its source of truth
 * with the middleware (`src/lib/securityHeaders.ts`) used for dynamic routes.
 */
import fs from "node:fs";
import http from "node:http";
import { createRequestHandler } from "./server-handler.mjs";

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

const server = http.createServer(
  createRequestHandler({ handler, securityHeaders }),
);

server.listen(port, host, () => {
  console.log(
    `[server] listening on http://${host}:${port} ` +
      `(${Object.keys(securityHeaders).length} security headers)`,
  );
});
