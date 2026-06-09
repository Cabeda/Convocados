import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { authenticateRequest } from "~/lib/authenticate.server";

/** GET /api/me/notifications — get in-app notification feed */
export const GET: APIRoute = async ({ request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const notifications = await prisma.inAppNotification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, type: true, title: true, body: true, url: true, eventId: true, readAt: true, createdAt: true },
  });

  const hasMore = notifications.length > limit;
  const slice = hasMore ? notifications.slice(0, limit) : notifications;
  const unreadCount = await prisma.inAppNotification.count({ where: { userId, readAt: null } });

  return Response.json({
    notifications: slice,
    unreadCount,
    nextCursor: hasMore ? slice[slice.length - 1].id : null,
    hasMore,
  });
};

/** POST /api/me/notifications/read — mark notifications as read */
export const POST: APIRoute = async ({ request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { ids } = body as { ids?: string[] };

  if (ids && Array.isArray(ids)) {
    await prisma.inAppNotification.updateMany({
      where: { userId, id: { in: ids } },
      data: { readAt: new Date() },
    });
  } else {
    // Mark all as read
    await prisma.inAppNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  return Response.json({ ok: true });
};
