import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { calculateAttendance } from "../../../../lib/attendance";
import { occurrenceRosterNamesMap } from "../../../../lib/gameRoster.server";

export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id ?? "";

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });

  if (!event) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const history = await prisma.gameHistory.findMany({
    where: { eventId },
    select: { id: true, status: true, dateTime: true, teamsSnapshot: true },
    orderBy: { dateTime: "asc" },
  });

  // Who-played from the durable Game roster, snapshot residue as fallback (mrcokrf9)
  const namesById = await occurrenceRosterNamesMap(
    eventId,
    history.map((h) => ({ key: h.id, dateTime: h.dateTime, teamsSnapshot: h.teamsSnapshot })),
  );
  const result = calculateAttendance(history.map((h) => ({ ...h, playerNames: namesById.get(h.id) ?? [] })));

  return Response.json(result);
};
