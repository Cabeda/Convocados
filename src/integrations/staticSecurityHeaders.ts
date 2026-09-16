import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { SECURITY_HEADERS, htmlFilesToPathnames } from "../lib/securityHeaders";

/** Recursively list files under `root`, returned as POSIX-style relative paths. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Apply the shared security headers to prerendered pages.
 *
 * Prerendered routes are written to disk and served as static files, so
 * `src/middleware.ts` never runs for them — the pages that most need a CSP and
 * clickjacking protection (sign-in, dashboard) were previously served with no
 * security headers at all.
 *
 * `@astrojs/node` supports this: with `staticHeaders: true` it reads
 * `dist/_headers.json` and applies matching entries to prerendered responses.
 * Its own writer emits a Content-Security-Policy only (and an empty array when
 * Astro's `security.csp` is off), so this integration emits the full header set
 * for every prerendered document.
 */
export function staticSecurityHeaders(): AstroIntegration {
  let outDir: URL;
  let clientDir: URL;

  return {
    name: "convocados:static-security-headers",
    hooks: {
      "astro:config:done": ({ config }) => {
        outDir = config.outDir;
        clientDir = config.build.client;
      },
      "astro:build:done": async ({ logger }) => {
        const root = fileURLToPath(outDir);
        const client = fileURLToPath(clientDir);
        if (!fs.existsSync(client)) {
          logger.warn(`no client build output at ${client}; skipping static security headers`);
          return;
        }

        const pathnames = htmlFilesToPathnames(listFiles(client));
        const headers = Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value }));
        const entries = pathnames.map((pathname) => ({ pathname, headers }));

        const target = path.join(root, "_headers.json");
        fs.writeFileSync(target, JSON.stringify(entries));
        logger.info(
          `wrote security headers for ${entries.length} prerendered route(s) to ${target}`,
        );
      },
    },
  };
}
