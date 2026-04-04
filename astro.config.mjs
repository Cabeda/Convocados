import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import pkg from "./package.json" assert { type: "json" };

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
  vite: {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  },
});
