import type { APIRoute } from "astro";

/** Keep old app versions and cron callers from reviving the retired integration. */
export const retiredCourt: APIRoute = () => Response.json({
  error: "Court discovery has been retired. Enter a venue manually when creating or editing a game.",
}, { status: 410 });
