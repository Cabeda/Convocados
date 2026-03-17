import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const body = await request.json();
  const balanced = Boolean(body.balanced);

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  await prisma.event.update({
    where: { id: params.id },
    data: { balanced },
  });

  return Response.json({ balanced });
};
