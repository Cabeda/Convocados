import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { calculateAttendance } from "../../../../lib/attendance";

export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id!;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });

  if (!event) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const history = await prisma.gameHistory.findMany({
    where: { eventId },
    select: { status: true, dateTime: true, teamsSnapshot: true },
    orderBy: { dateTime: "asc" },
  });

  const result = calculateAttendance(history);

  return Response.json(result);
};
