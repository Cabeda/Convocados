import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";

// GET /api/events/[id]/history — list all history entries
export const GET: APIRoute = async ({ params }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const history = await prisma.gameHistory.findMany({
    where: { eventId: params.id },
    orderBy: { dateTime: "desc" },
  });

  return Response.json(history.map((h) => ({
    ...h,
    dateTime: h.dateTime.toISOString(),
    editableUntil: h.editableUntil.toISOString(),
    createdAt: h.createdAt.toISOString(),
    editable: h.editableUntil > new Date(),
  })));
};
