import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { SECURITY_HEADERS } from "../lib/securityHeaders";

/**
 * Emit the shared security-header map for the runtime server.
 *
 * Astro's node adapter serves prerendered pages as static files, which bypass
 * `src/middleware.ts`, so those responses carried no CSP / HSTS / XFO / XCTO /
 * Referrer-Policy / Permissions-Policy. The adapter's own `staticHeaders`
 * option cannot fix that in a container: it resolves `_headers.json` against
 * the **build-time** output directory baked into the manifest (CI builds under
 * /home/runner/..., the image runs /app), so the file is never found.
 * `scripts/server.mjs` injects the headers at the HTTP layer instead,
 * independent of build paths.
 *
 * `src/lib/securityHeaders.ts` stays the single source of truth for both the
 * middleware (dynamic routes) and this build-time artifact (static routes).
 */
export function staticSecurityHeaders(): AstroIntegration {
  let outDir: URL;

  return {
    name: "convocados:static-security-headers",
    hooks: {
      "astro:config:done": ({ config }) => {
        outDir = config.outDir;
      },
      "astro:build:done": async ({ logger }) => {
        const root = fileURLToPath(outDir);
        fs.mkdirSync(root, { recursive: true });
        const target = path.join(root, "security-headers.json");
        fs.writeFileSync(target, JSON.stringify(SECURITY_HEADERS, null, 2));
        logger.info(
          `wrote ${Object.keys(SECURITY_HEADERS).length} security headers to ${target}`,
        );
      },
    },
  };
}
