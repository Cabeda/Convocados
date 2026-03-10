import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { parseRecurrenceRule, nextOccurrence } from "../../../../lib/recurrence";

export const GET: APIRoute = async ({ params }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      players: { orderBy: { createdAt: "asc" } },
      teamResults: { include: { members: { orderBy: { order: "asc" } } } },
    },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  let wasReset = false;

  // Lazy recurrence reset
  if (event.isRecurring && event.nextResetAt && event.nextResetAt <= new Date()) {
    const rule = parseRecurrenceRule(event.recurrenceRule);
    if (rule) {
      const newDateTime = nextOccurrence(event.dateTime, rule, new Date());
      const newNextResetAt = new Date(newDateTime.getTime() + 60 * 60 * 1000);
      const editableUntil = new Date(event.dateTime.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Snapshot current game into history before clearing
      const teamsSnapshot = event.teamResults.length > 0
        ? JSON.stringify(event.teamResults.map((tr) => ({
            team: tr.name,
            players: tr.members.map((m) => ({ name: m.name, order: m.order })),
          })))
        : null;

      await prisma.$transaction([
        prisma.gameHistory.create({
          data: {
            eventId: event.id,
            dateTime: event.dateTime,
            teamOneName: event.teamOneName,
            teamTwoName: event.teamTwoName,
            teamsSnapshot,
            editableUntil,
          },
        }),
        prisma.player.deleteMany({ where: { eventId: event.id } }),
        prisma.teamResult.deleteMany({ where: { eventId: event.id } }),
        prisma.event.update({
          where: { id: event.id },
          data: { dateTime: newDateTime, nextResetAt: newNextResetAt },
        }),
      ]);

      const fresh = await prisma.event.findUnique({
        where: { id: event.id },
        include: {
          players: { orderBy: { createdAt: "asc" } },
          teamResults: { include: { members: { orderBy: { order: "asc" } } } },
        },
      });

      if (fresh) Object.assign(event, fresh);
      wasReset = true;
    }
  }

  return Response.json({
    wasReset,
    ...event,
    dateTime: event.dateTime.toISOString(),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    nextResetAt: event.nextResetAt?.toISOString() ?? null,
    players: event.players.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
  });
};
