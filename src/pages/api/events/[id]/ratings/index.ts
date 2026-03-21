import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { parsePaginationParams, buildPaginatedResponse } from "../../../../../lib/pagination";
import { checkOwnership } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";

export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const url = new URL(request.url);
  const { limit, cursor } = parsePaginationParams(url);

  const ratings = await prisma.playerRating.findMany({
    where: { eventId: params.id },
    orderBy: { rating: "desc" },
    select: { id: true, name: true, rating: true, initialRating: true, gamesPlayed: true, wins: true, draws: true, losses: true },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return Response.json(buildPaginatedResponse(ratings, limit));
};

/**
 * PATCH — Set a player's initial rating (admin/owner only).
 * Body: { name: string, initialRating: number }
 * Clamps to [500, 1500]. Updates both rating and initialRating.
 * If the player has games, only initialRating is stored (use recalculate to apply).
 */
export const PATCH: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner or admin can set ratings." }, { status: 403 });
  }

  const body = await request.json();
  const { name, initialRating } = body as { name?: string; initialRating?: number };

  if (!name || typeof name !== "string") {
    return Response.json({ error: "Player name is required." }, { status: 400 });
  }
  if (initialRating == null || typeof initialRating !== "number" || !isFinite(initialRating)) {
    return Response.json({ error: "initialRating must be a number." }, { status: 400 });
  }

  const clamped = Math.round(Math.min(1500, Math.max(500, initialRating)));

  // Upsert: create if not exists, update if exists
  const existing = await prisma.playerRating.findUnique({
    where: { eventId_name: { eventId, name } },
  });

  if (existing) {
    // If player has no games yet, also update the live rating
    const data = existing.gamesPlayed === 0
      ? { initialRating: clamped, rating: clamped }
      : { initialRating: clamped };

    const updated = await prisma.playerRating.update({
      where: { id: existing.id },
      data,
    });
    return Response.json({ ok: true, rating: updated.rating, initialRating: updated.initialRating, needsRecalculate: existing.gamesPlayed > 0 });
  } else {
    const created = await prisma.playerRating.create({
      data: { eventId, name, rating: clamped, initialRating: clamped },
    });
    return Response.json({ ok: true, rating: created.rating, initialRating: created.initialRating, needsRecalculate: false });
  }
};
