import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession, checkEventAdmin } from "../../../../lib/auth.helpers.server";
import { checkAccess } from "../../../../lib/eventAccess";

export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      players: { orderBy: { order: "asc" } },
      teamResults: { include: { members: { orderBy: { order: "asc" } } } },
    },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // ── Access control (mirrors GET /api/events/[id]) ─────────────────────────
  if (event.accessPassword) {
    const session = await getSession(request);
    const isInvited = session?.user
      ? (await prisma.eventInvite.count({ where: { eventId: event.id, userId: session.user.id } })) > 0
      : false;
    const isEventAdmin = session?.user
      ? await checkEventAdmin(event.id, session.user.id)
      : false;

    const access = checkAccess({
      eventOwnerId: event.ownerId,
      accessPassword: event.accessPassword,
      requestUserId: session?.user?.id ?? null,
      cookieHeader: request.headers.get("cookie"),
      eventId: event.id,
      isInvited: isInvited || isEventAdmin,
    });

    if (!access.granted) {
      return Response.json({
        locked: true,
        id: event.id,
        title: event.title,
        hasPassword: true,
      });
    }
  }

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
