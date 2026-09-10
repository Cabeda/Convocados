import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

/**
 * Competition settings (ADR 0031 / dex onz6p0b0).
 * One master `enabled` bundles Skill Rating (Elo) + balanced teams + Season
 * Rank + MVP-rating. Advanced: inactivity decay + inactive-Rank behaviour.
 * Locked read-only while a Season is active or under review.
 */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  let body: { enabled?: unknown; rankDecayEnabled?: unknown; inactiveRankBehavior?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const activeSeason = await prisma.season.findFirst({
    where: { eventId: params.id, status: { in: ["active", "review"] } },
    select: { id: true },
  });
  if (activeSeason) {
    return Response.json({ error: "Competitive settings are locked while a Season is active." }, { status: 409 });
  }

  const data: {
    eloEnabled?: boolean;
    rankEnabled?: boolean;
    balanced?: boolean;
    hideEloInTeams?: boolean;
    mvpEloEnabled?: boolean;
    rankDecayEnabled?: boolean;
    inactiveRankBehavior?: string;
  } = {};

  if (typeof body.enabled === "boolean") {
    data.eloEnabled = body.enabled;
    data.rankEnabled = body.enabled;
    data.balanced = body.enabled;
    if (!body.enabled) {
      data.hideEloInTeams = false;
      data.mvpEloEnabled = false;
    }
  }
  if (typeof body.rankDecayEnabled === "boolean") data.rankDecayEnabled = body.rankDecayEnabled;
  if (body.inactiveRankBehavior === "freeze" || body.inactiveRankBehavior === "reset") {
    data.inactiveRankBehavior = body.inactiveRankBehavior;
  }
  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await prisma.event.update({ where: { id: params.id }, data });
  return Response.json({
    eloEnabled: updated.eloEnabled,
    rankEnabled: updated.rankEnabled,
    rankDecayEnabled: updated.rankDecayEnabled,
    inactiveRankBehavior: updated.inactiveRankBehavior,
    balanced: updated.balanced,
    hideEloInTeams: updated.hideEloInTeams,
    mvpEloEnabled: updated.mvpEloEnabled,
  });
};
