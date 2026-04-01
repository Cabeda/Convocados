import type { APIRoute } from "astro";
import { getSession } from "~/lib/auth.helpers.server";
import { isAdmin, deleteUser } from "~/lib/admin.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";

export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user?.id || !(await isAdmin(session.user.id))) {
    return new Response("Forbidden", { status: 403 });
  }

  const targetId = params.id;
  if (!targetId) {
    return Response.json({ error: "Missing user id" }, { status: 400 });
  }

  if (targetId === session.user.id) {
    return Response.json({ error: "adminCannotDeleteSelf" }, { status: 400 });
  }

  const deleted = await deleteUser(targetId);
  if (!deleted) return Response.json({ error: "User not found." }, { status: 404 });
  return Response.json({ ok: true });
};
