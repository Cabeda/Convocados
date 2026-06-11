import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { rateLimitResponse } from "../../../lib/apiRateLimit.server";

async function resolveUserId(request: Request): Promise<string | null> {
  const authCtx = await authenticateRequest(request);
  return authCtx?.userId ?? (await getSession(request))?.user?.id ?? null;
}

/** DELETE: remove one of the current user's court watches. */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const userId = await resolveUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const watch = await prisma.courtWatch.findUnique({ where: { id: params.id } });
  if (!watch) return Response.json({ error: "Not found." }, { status: 404 });
  if (watch.userId !== userId) return Response.json({ error: "Forbidden." }, { status: 403 });

  await prisma.courtWatch.delete({ where: { id: params.id } });
  return Response.json({ ok: true });
};
