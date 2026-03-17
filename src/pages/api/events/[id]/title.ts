import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers";

export const PUT: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner } = await checkOwnership(request, event.ownerId);
  if (event.ownerId && !isOwner) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const title = String(body.title ?? "").trim().slice(0, 100);
  if (!title) return Response.json({ error: "Title is required." }, { status: 400 });

  await prisma.event.update({
    where: { id: params.id },
    data: { title },
  });

  return Response.json({ title });
};
