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

  // Lazy recurrence reset — optimistic lock via compare-and-swap on nextResetAt.
  // Only the request that wins the updateMany (count=1) proceeds; concurrent
  // requests get count=0 and skip, preventing double-snapshots.
  if (event.isRecurring && event.nextResetAt && event.nextResetAt <= new Date()) {
    const rule = parseRecurrenceRule(event.recurrenceRule);
    if (rule) {
      const currentNextResetAt = event.nextResetAt;
      const newDateTime = nextOccurrence(event.dateTime, rule, new Date());
      const newNextResetAt = new Date(newDateTime.getTime() + 60 * 60 * 1000);

      // Atomically claim the reset — only one concurrent request will get count=1
      const claimed = await prisma.event.updateMany({
        where: { id: event.id, nextResetAt: currentNextResetAt },
        data: { nextResetAt: newNextResetAt },
      });

      if (claimed.count === 1) {
        const editableUntil = new Date(event.dateTime.getTime() + 7 * 24 * 60 * 60 * 1000);
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
            data: { dateTime: newDateTime },
          }),
        ]);

        wasReset = true;
      }

      const fresh = await prisma.event.findUnique({
        where: { id: event.id },
        include: {
          players: { orderBy: { createdAt: "asc" } },
          teamResults: { include: { members: { orderBy: { order: "asc" } } } },
        },
      });
      if (fresh) Object.assign(event, fresh);
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
