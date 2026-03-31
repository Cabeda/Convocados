import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import pkg from "./package.json" assert { type: "json" };

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  security: { checkOrigin: true },
  server: { host: true },
  vite: {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  },
});
