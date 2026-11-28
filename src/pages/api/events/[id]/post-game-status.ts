import type { APIRoute } from "astro";
import { computePostGameStatus } from "../../../../lib/postgame.server";

/**
 * GET /api/events/:id/post-game-status
 *
 * Returns the post-game completion status for an event:
 * - gameEnded: whether dateTime + durationMinutes is in the past
 * - hasScore: whether the most recent GameHistory has scoreOne/scoreTwo set
 * - hasCost: whether an EventCost record exists with totalAmount > 0
 * - allPaid: whether all payments are paid (or no cost set)
 * - allComplete: hasScore && allPaid && myMvpComplete (viewer-scoped dismissal)
 * - isParticipant: whether the current user is involved in settling the game
 *   (Owner/Admin, or name on the settled game's teams/payment roll, or the
 *   played Game's participants when no snapshot exists yet)
 *
 * `?poll=1` is the page's 15 s refresh: the same answer without `viewerNames` and `payerHasPaymentDetails`,
 * which do not change while the page is open (the client keeps the ones from the page load).
 */
export const GET: APIRoute = async ({ params, request }) => {
  const status = await computePostGameStatus(params.id!, request, { light: new URL(request.url).searchParams.get("poll") === "1" });
  if (!status) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json(status);
};
