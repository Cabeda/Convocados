import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { recalculateAllRatings } from "../../../../../../lib/elo.server";

export const POST: APIRoute = async ({ params }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const processed = await recalculateAllRatings(params.id!);
  return Response.json({ ok: true, gamesProcessed: processed });
};
