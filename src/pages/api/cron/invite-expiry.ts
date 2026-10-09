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
 * Driven by the scheduler worker; the timeout is deliberately inside the
 * 5-minute maintenance window so an idle pass is a single indexed query.
 */
export const POST: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
  const denied = requireCronSecret(request, cronSecret);
  if (denied) return denied;

  const expired = await expirePastGameInvites();
  return Response.json({ ok: true, expired });
};
