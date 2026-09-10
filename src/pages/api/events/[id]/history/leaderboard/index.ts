import type { APIRoute } from "astro";
import { computeLeaderboardPayload } from "~/lib/leaderboard.server";

export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const requestedSeasonId = new URL(request.url).searchParams.get("seasonId");
  const payload = await computeLeaderboardPayload(eventId, requestedSeasonId, request);
  if (!payload) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json(payload);
};
