import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import pkg from "./package.json" assert { type: "json" };

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  // CSRF origin check is disabled at the Astro level because better-auth
  // handles CSRF via trustedOrigins, and OAuth 2.1 endpoints must accept
  // requests from external clients (mobile apps, API clients) that don't
  // send a same-origin Origin header.
  security: { checkOrigin: false },
  server: { host: true },
  vite: {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  },
});
