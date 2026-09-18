import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession, checkEventAdmin } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { cancelCurrentGame, CancelError } from "../../../../lib/cancelEvent.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const isOwner = !!(event.ownerId && session.user.id === event.ownerId);
  const isAdmin = !isOwner ? await checkEventAdmin(event.id, session.user.id) : false;

  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner or an admin can cancel the game." }, { status: 403 });
  }

  try {
    await cancelCurrentGame(event.id, { id: session.user.id, name: session.user.name ?? null });
  } catch (err) {
    if (err instanceof CancelError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  return Response.json({ ok: true });
};
