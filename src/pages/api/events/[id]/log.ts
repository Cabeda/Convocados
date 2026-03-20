import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";

const PAGE_SIZE = 50;

/** GET /api/events/:id/log?cursor=<id>&limit=<n> — paginated activity log */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });

  if (!event) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(Number(url.searchParams.get("limit")) || PAGE_SIZE, 100);

  const entries = await prisma.eventLog.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = entries.length > limit;
  const data = hasMore ? entries.slice(0, limit) : entries;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return Response.json({
    entries: data.map((e) => ({
      id: e.id,
      action: e.action,
      actor: e.actor,
      actorId: e.actorId,
      details: JSON.parse(e.details),
      createdAt: e.createdAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  });
};
