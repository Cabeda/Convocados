import type { APIRoute } from "astro";
import { runPickupSweep, archiveExpiredPickups, resolveAnchors } from "../../../lib/pickupSweep.server";
import { createLogger } from "../../../lib/logger.server";

const log = createLogger("pickups");

/**
 * POST /api/cron/pickups — twice-daily sweep that turns booked Playtomic court
 * slots into public Open Pickups (ADR-0021). Also archives expired un-adopted
 * pickups. Runs on the Fly scheduler with the CRON_SECRET bearer token.
 */
export const POST: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const anchors = resolveAnchors();

  const [sweep, archived] = await Promise.all([
    runPickupSweep(anchors),
    archiveExpiredPickups(),
  ]);

  log.info({ ...sweep, archived }, "Pickup sweep complete");

  return Response.json({ ok: true, ...sweep, archived });
};