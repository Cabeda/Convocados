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
 */
export const GET: APIRoute = async ({ params, request }) => {
  const status = await computePostGameStatus(params.id!, request);
  if (!status) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json(status);
};
