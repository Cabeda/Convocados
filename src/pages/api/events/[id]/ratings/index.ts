import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { parsePaginationParams, buildPaginatedResponse } from "../../../../../lib/pagination";
import { checkOwnership } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../../lib/eventLog.server";
import { recalculateAllRatings } from "../../../../../lib/elo.server";

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
 * Requires allowManualRating to be enabled on the event.
 * Players with 0 games: clamped to [800, 1200].
 * Players with games: clamped to [500, 1500], auto-recalculates.
 */
export const PATCH: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Gate behind allowManualRating setting
  if (!event.allowManualRating) {
    return Response.json({ error: "Manual rating editing is disabled for this event." }, { status: 403 });
  }

  const { isOwner, isAdmin, session } = await checkOwnership(request, event.ownerId, undefined, eventId);
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

  // Upsert: create if not exists, update if exists
  const existing = await prisma.playerRating.findUnique({
    where: { eventId_name: { eventId, name } },
  });

  // Tighter range for players with 0 games (800-1200), wider for experienced (500-1500)
  const hasGames = existing ? existing.gamesPlayed > 0 : false;
  const min = hasGames ? 500 : 800;
  const max = hasGames ? 1500 : 1200;
  const clamped = Math.round(Math.min(max, Math.max(min, initialRating)));

  const actorName = session?.user?.name ?? null;
  const actorId = session?.user?.id ?? null;

  if (existing) {
    const oldRating = existing.rating;
    const oldInitial = existing.initialRating;

    // If player has no games yet, also update the live rating
    const data = existing.gamesPlayed === 0
      ? { initialRating: clamped, rating: clamped }
      : { initialRating: clamped };

    const updated = await prisma.playerRating.update({
      where: { id: existing.id },
      data,
    });

    // Audit log
    logEvent(eventId, "rating_initial_set", actorName, actorId, {
      player: name,
      oldInitialRating: oldInitial,
      newInitialRating: clamped,
      oldRating,
      hasGames,
    });

    // Auto-recalculate if player has games
    let recalculated = false;
    if (existing.gamesPlayed > 0) {
      try {
        await recalculateAllRatings(eventId);
        recalculated = true;
      } catch { /* recalculation is best-effort */ }
    }

    // Re-fetch the rating after potential recalculation
    const final = recalculated
      ? await prisma.playerRating.findUnique({ where: { eventId_name: { eventId, name } } })
      : updated;

    return Response.json({
      ok: true,
      rating: final?.rating ?? updated.rating,
      initialRating: final?.initialRating ?? updated.initialRating,
      needsRecalculate: false,
      recalculated,
    });
  } else {
    const created = await prisma.playerRating.create({
      data: { eventId, name, rating: clamped, initialRating: clamped },
    });

    // Audit log
    logEvent(eventId, "rating_initial_set", actorName, actorId, {
      player: name,
      oldInitialRating: null,
      newInitialRating: clamped,
      oldRating: null,
      hasGames: false,
    });

    return Response.json({ ok: true, rating: created.rating, initialRating: created.initialRating, needsRecalculate: false, recalculated: false });
  }
};
