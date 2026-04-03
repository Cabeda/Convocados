import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { getSession } from "../../../lib/auth.helpers.server";

export const GET: APIRoute = async ({ request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true },
  });

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  return Response.json(user);
};
