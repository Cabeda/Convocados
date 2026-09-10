import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { authorizeSeasonRequest, getSeasonForEvent } from "~/lib/seasonSetup.server";
import { getSeasonRankPayload } from "~/lib/seasonRank.server";

/** GET /api/events/:id/seasons/:seasonId/rank — Season Rank for Event members. */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const seasonId = params.seasonId ?? "";
  const season = await getSeasonForEvent(seasonId, eventId);
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });

  const session = await getSession(request);
  const authz = await authorizeSeasonRequest(season, session, request);
  if (!authz.allowed) return Response.json({ error: "Event access required." }, { status: 403 });

  const payload = await getSeasonRankPayload(eventId, seasonId);
  if (!payload) return Response.json({ error: "Season not found." }, { status: 404 });

  // The viewer's own EventPlayer name, so the client can highlight "you" and
  // detect tier transitions for the celebration/demotion modal.
  const youName = session?.user
    ? (await prisma.eventPlayer.findFirst({ where: { eventId, userId: session.user.id }, select: { name: true } }))?.name ?? null
    : null;

  return Response.json({ ...payload, youName });
};
