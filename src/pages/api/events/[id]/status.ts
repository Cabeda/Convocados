import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";

export const GET: APIRoute = async ({ params }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      players: { orderBy: { createdAt: "asc" } },
      teamResults: { include: { members: { orderBy: { order: "asc" } } } },
    },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const active = event.players.slice(0, event.maxPlayers);
  const bench = event.players.slice(event.maxPlayers);

  return Response.json({
    id: event.id,
    title: event.title,
    location: event.location,
    dateTime: event.dateTime.toISOString(),
    maxPlayers: event.maxPlayers,
    teamOneName: event.teamOneName,
    teamTwoName: event.teamTwoName,
    isRecurring: event.isRecurring,
    nextResetAt: event.nextResetAt?.toISOString() ?? null,
    players: {
      active: active.map((p) => ({ id: p.id, name: p.name })),
      bench: bench.map((p) => ({ id: p.id, name: p.name })),
      total: event.players.length,
      spotsLeft: Math.max(0, event.maxPlayers - active.length),
    },
    teams: event.teamResults.map((tr) => ({
      name: tr.name,
      players: tr.members.map((m) => m.name),
    })),
  });
};
