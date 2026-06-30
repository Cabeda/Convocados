import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getDefaultMaxPlayers } from "../../../../lib/sports";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { enqueueNotification, drainNotificationQueue } from "../../../../lib/notificationQueue.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const sport = String(body.sport ?? "").trim().slice(0, 50);
  if (!sport) return Response.json({ error: "Sport is required." }, { status: 400 });

  const defaultMaxPlayers = getDefaultMaxPlayers(sport);
  const oldMaxPlayers = event.maxPlayers;

  await prisma.event.update({
    where: { id: params.id },
    data: { sport, maxPlayers: defaultMaxPlayers },
  });

  // ADR 0017: If maxPlayers increased, notify bench players who got promoted (Tier 2, via queue)
  if (defaultMaxPlayers > oldMaxPlayers) {
    const players = await prisma.player.findMany({
      where: { eventId: params.id!, archivedAt: null, userId: { not: null } },
      orderBy: { order: "asc" },
    });
    const promoted = players.filter((p) => p.order >= oldMaxPlayers && p.order < defaultMaxPlayers);
    if (promoted.length > 0) {
      // Enqueue one notification per promoted player via the queue (respects tier + overrides)
      for (const p of promoted) {
        if (!p.userId) continue;
        await enqueueNotification(params.id!, "bench_promoted_capacity", {
          title: event.title,
          key: "notifyBenchPromotedCapacity",
          params: { title: event.title },
          url: `/events/${params.id}`,
          spotsLeft: 0,
        }, p.userId);
      }
      if (!process.env.VITEST) {
        await drainNotificationQueue().catch(() => {});
      }
    }
  }

  return Response.json({ sport, maxPlayers: defaultMaxPlayers });
};
