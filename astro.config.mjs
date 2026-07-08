import { defineConfig, memoryCache, logHandlers } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import pkg from "./package.json" with { type: "json" };

const isProd = process.env.NODE_ENV === "production";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  // Astro's built-in checkOrigin is disabled because it runs before middleware
  // and cannot be bypassed per-route. CSRF protection is handled by custom
  // middleware (src/middleware.ts) which validates Origin headers on session-
  // authenticated mutations while allowing OAuth/Bearer-authenticated requests.
  security: { checkOrigin: false },
  server: { host: true },
  // ponytail: JSON logs in production for structured log aggregation (Fly.io logs).
  // Human-readable console in dev.
  logger: isProd ? logHandlers.json() : logHandlers.console(),
  // ponytail: in-memory route cache. Event pages (public, read-heavy) get a
  // short TTL with stale-while-revalidate. API mutations invalidate via tags.
  cache: {
    provider: memoryCache(),
  },
  routeRules: {
    // Public event pages — cache 60s, serve stale 30s while revalidating
    "/events/[...path]": { maxAge: 60, swr: 30 },
    // Public games listing
    "/games": { maxAge: 120, swr: 60 },
    // Docs pages — rarely change
    "/docs/[...path]": { maxAge: 3600, swr: 300 },
  },
  vite: {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  },
});
