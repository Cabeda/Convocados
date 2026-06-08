import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../../lib/authenticate.server";

/**
 * POST /api/events/[id]/follow — follow an event (receive notifications, show on dashboard).
 * DELETE /api/events/[id]/follow — unfollow an event.
 * GET /api/events/[id]/follow — check if the authenticated user follows this event.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) return Response.json({ following: false });

  const eventId = params.id ?? "";
  const follow = await prisma.eventFollow.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
  return Response.json({ following: !!follow });
};

export const POST: APIRoute = async ({ params, request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  await prisma.eventFollow.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId },
    update: {},
  });

  return Response.json({ ok: true, following: true });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const eventId = params.id ?? "";
  await prisma.eventFollow.deleteMany({ where: { eventId, userId } });
  return Response.json({ ok: true, following: false });
};
