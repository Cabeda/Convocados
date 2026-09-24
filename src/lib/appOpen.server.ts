import { getSession } from "./auth.helpers.server";
import { recordAppOpen } from "./rsvp.server";
import { createLogger } from "./logger.server";

const log = createLogger("appOpen");

/**
 * Resolve the caller's session and record today's app-open heartbeat.
 *
 * Fire-and-forget: callers must not await this on the request path (it is
 * invoked after the response is produced). Idempotent per user per day and it
 * never throws, so a tracking failure can never break a page load.
 */
export async function trackAppOpen(request: Request): Promise<void> {
  try {
    const session = await getSession(request);
    const userId = session?.user?.id;
    if (!userId) return;
    await recordAppOpen(userId, new Date(), "web");
  } catch (err) {
    log.error({ err }, "app-open heartbeat failed");
  }
}
