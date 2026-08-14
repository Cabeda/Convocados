import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession, checkEventAdmin } from "../../../../lib/auth.helpers.server";
import { checkAccess } from "../../../../lib/eventAccess";
import { getActiveRosterState } from "../../../../lib/roster.server";

export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
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

  // ADR 0016: the authoritative roster comes from the shared helper — the
  // current game's GameParticipant rows when a current game exists, the legacy
  // Player fallback otherwise. Raw legacy/archived Player rows must not leak
  // into the status payload on recurring events (they accumulate across
  // occurrences and would inflate active/bench/spotsLeft).
  const roster = await getActiveRosterState(event.id, event.maxPlayers, event.currentGameId);
  const playerRows = await prisma.player.findMany({
    where: { eventId: event.id, name: { in: roster.members.map((m) => m.name) } },
    select: { id: true, name: true },
  });
  const idByName = new Map(playerRows.map((p) => [p.name, p.id]));
  const toView = (m: { name: string }) => ({ id: idByName.get(m.name) ?? "", name: m.name });
  const active = roster.members.slice(0, event.maxPlayers);
  const bench = roster.members.slice(event.maxPlayers);

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
      active: active.map(toView),
      bench: bench.map(toView),
      total: roster.totalCount,
      spotsLeft: Math.max(0, event.maxPlayers - roster.activeCount),
    },
    teams: event.teamResults.map((tr) => ({
      name: tr.name,
      players: tr.members.map((m) => m.name),
    })),
  });
};
