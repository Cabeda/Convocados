import type { APIRoute } from "astro";
import { expirePastGameInvites } from "~/lib/invite.server";
import { requireCronSecret } from "~/lib/cronAuth.server";

/**
 * Eager invite expiry (GH #1273): expire pending PlayerInvites whose game has
 * already kicked off.
 *
 * The lazy path (`expirePendingInvites`) only runs for the event's current game
 * or for the one invite a human just opened, so invites belonging to a lapsed
 * occurrence stay `pending` forever and an organiser has to retract them by
 * hand. This sweep walks every game past its kickoff instead — including games
 * of one-off events and of events whose next occurrence is weeks away, neither
 * of which any other caller reaches.
 *
 * Driven by the scheduler worker every 5 minutes (its 30s fetch timeout is
 * deliberately inside that window). An idle pass is NOT a single indexed
 * query: one query finds the distinct gameIds that still hold a pending invite
 * past its kickoff, then two-to-three per stale game — up to
 * PAST_GAME_SWEEP_LIMIT = 100 games, so ~301 queries per tick at worst. The
 * `game.dateTime` relation filter cannot use an index (Prisma cannot index
 * across a relation), so that first query scans the pending PlayerInvite rows;
 * the sweep cap, not the query plan, is what bounds the cost.
 */
export const POST: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
  const denied = requireCronSecret(request, cronSecret);
  if (denied) return denied;

  const expired = await expirePastGameInvites();
  return Response.json({ ok: true, expired });
};
