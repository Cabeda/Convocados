import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { parseRecurrenceRule, nextOccurrence } from "../../../../lib/recurrence";
import { fireWebhooks } from "../../../../lib/webhook.server";
import { autoPriorityEnroll } from "../../../../lib/priority.server";
import { getSession, checkEventAdmin } from "../../../../lib/auth.helpers.server";
import { checkAccess } from "../../../../lib/eventAccess";
import { cancelEventJobs, scheduleEventReminders } from "../../../../lib/scheduler.server";

export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      players: { where: { archivedAt: null }, orderBy: { order: "asc" } },
      teamResults: { include: { members: { orderBy: { order: "asc" } } } },
      owner: { select: { id: true, name: true } },
    },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // ── Access control ──────────────────────────────────────────────────────
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

  let wasReset = false;

  // Lazy recurrence reset — optimistic lock via compare-and-swap on nextResetAt.
  // Only the request that wins the updateMany (count=1) proceeds; concurrent
  // requests get count=0 and skip, preventing double-snapshots.
  if (event.isRecurring && event.nextResetAt && event.nextResetAt <= new Date()) {
    const rule = parseRecurrenceRule(event.recurrenceRule);
    if (rule) {
      const currentNextResetAt = event.nextResetAt;
      const newDateTime = nextOccurrence(event.dateTime, rule, new Date());
      const newNextResetAt = new Date(newDateTime.getTime() + event.durationMinutes * 60 * 1000);

      // Atomically claim the reset — only one concurrent request will get count=1
      const claimed = await prisma.event.updateMany({
        where: { id: event.id, nextResetAt: currentNextResetAt },
        data: { nextResetAt: newNextResetAt },
      });

      if (claimed.count === 1) {
        const editableUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const teamsSnapshot = event.teamResults.length > 0
          ? JSON.stringify(event.teamResults.map((tr) => ({
              team: tr.name,
              players: tr.members.map((m) => ({ name: m.name, order: m.order })),
            })))
          : null;

        // Snapshot payments before reset
        const eventCost = await prisma.eventCost.findUnique({
          where: { eventId: event.id },
          include: { payments: true },
        });
        const paymentsSnapshot = eventCost && eventCost.payments.length > 0
          ? JSON.stringify(eventCost.payments.map((p) => ({
              playerName: p.playerName,
              amount: p.amount,
              status: p.status,
              method: p.method,
            })))
          : null;

        // ADR 0016: mark old Game as played + create new Game + swap pointer
        const oldGameId = event.currentGameId;
        const newGame = await prisma.game.create({
          data: { eventId: event.id, dateTime: newDateTime, status: "upcoming" },
        });
        if (oldGameId) {
          await prisma.game.update({
            where: { id: oldGameId },
            data: { status: "played" },
          });
        }
        await prisma.event.update({
          where: { id: event.id },
          data: { currentGameId: newGame.id },
        });

        // ADR 0016: keep GameHistory for backward compat (read-only fallback),
        // but NO destructive deletes. Players/Teams/RSVPs stay intact on the old Game.
        // Guard against a duplicate snapshot: one may already exist if a score was
        // saved on the played Game before the reset ran (history PATCH materialises
        // a GameHistory on demand).
        const existingSnapshot = await prisma.gameHistory.findFirst({
          where: { eventId: event.id, dateTime: event.dateTime },
        });
        await prisma.$transaction([
          ...(existingSnapshot
            ? []
            : [prisma.gameHistory.create({
                data: {
                  eventId: event.id,
                  dateTime: event.dateTime,
                  teamOneName: event.teamOneName,
                  teamTwoName: event.teamTwoName,
                  teamsSnapshot,
                  paymentsSnapshot,
                  editableUntil,
                },
              })]),
          // Clear per-occurrence payments (PlayerPayment is still current-game-scoped until GamePayment migration)
          ...(eventCost ? [
            prisma.playerPayment.deleteMany({ where: { eventCostId: eventCost.id } }),
            prisma.eventCost.update({ where: { id: eventCost.id }, data: { tempPaymentMethods: null, tempPaymentDetails: null } }),
          ] : []),
          // Clear team members for the new game (teams are snapshotted in GameHistory above)
          ...event.teamResults.map((tr) =>
            prisma.teamMember.deleteMany({ where: { teamResultId: tr.id } }),
          ),
          prisma.event.update({
            where: { id: event.id },
            data: { dateTime: newDateTime, rsvpCutoffSent: false, recruitment48hSent: false, recruitment24hSent: false },
          }),
        ]);

        wasReset = true;

        // Fire game_reset webhook (non-blocking)
        fireWebhooks(event.id, "game_reset", {
          newDateTime: newDateTime.toISOString(),
        }).catch(() => {});

        // Auto-enroll priority players for the new occurrence (non-blocking)
        autoPriorityEnroll(event.id).catch(() => {});

        // ADR 0018: Auto-confirm regulars for the new occurrence (non-blocking)
        import("../../../../lib/autoConfirm.server")
          .then(({ applyAutoConfirm }) => applyAutoConfirm(event.id))
          .catch(() => {});

        // Schedule reminder jobs for the new occurrence (non-blocking)
        cancelEventJobs(event.id)
          .then(() => scheduleEventReminders(event.id, newDateTime, event.durationMinutes))
          .catch(() => {});
      }

      const fresh = await prisma.event.findUnique({
        where: { id: event.id },
        include: {
          players: { where: { archivedAt: null }, orderBy: { order: "asc" } },
          teamResults: { include: { members: { orderBy: { order: "asc" } } } },
        },
      });
      if (fresh) Object.assign(event, fresh);
    }
  }

  // Check if current user is an admin of this event
  let isAdmin = false;
  if (request && event.ownerId) {
    try {
      const sessionForAdmin = await getSession(request);
      if (sessionForAdmin?.user) {
        isAdmin = await checkEventAdmin(event.id, sessionForAdmin.user.id);
      }
    } catch { /* ignore — request may not have valid headers in tests */ }
  }

  // ADR 0016: read players from GameParticipant+EventPlayer when currentGameId is set
  let playersPayload: any[];
  if (event.currentGameId) {
    const participants = await prisma.gameParticipant.findMany({
      where: { gameId: event.currentGameId, archivedAt: null },
      include: { eventPlayer: true },
      orderBy: { order: "asc" },
    });

    // ponytail: EventPlayer.userId may be stale (null) if the player rejoined
    // after a reset and the upsert didn't update it. Fall back to the event-level
    // Player.userId which is the authoritative link.
    const playersByName = new Map(
      event.players
        .filter((p) => p.userId)
        .map((p) => [p.name, p.userId]),
    );

    playersPayload = participants.map((gp) => ({
      id: gp.eventPlayer.id,
      name: gp.eventPlayer.name,
      order: gp.order,
      eventId: gp.eventPlayer.eventId,
      userId: gp.eventPlayer.userId ?? playersByName.get(gp.eventPlayer.name) ?? null,
      createdAt: gp.createdAt.toISOString(),
    }));
  } else {
    playersPayload = event.players.map((p) => ({ ...p, userId: p.userId ?? null, createdAt: p.createdAt.toISOString() }));
  }

  // ADR 0016: include current game status for the UI
  let gameStatus: string | null = null;
  if (event.currentGameId) {
    const currentGame = await prisma.game.findUnique({
      where: { id: event.currentGameId },
      select: { status: true },
    });
    gameStatus = currentGame?.status ?? null;
  }

  // ADR 0016: filter teamResults to only include members in the current game's player list.
  // After a recurrence reset, old team members linger in TeamResult but the player list
  // is now game-scoped via GameParticipant. Only show team members who are active players.
  const activePlayerNames = new Set(playersPayload.map((p: { name: string }) => p.name));
  const filteredTeamResults = event.teamResults.map((tr) => ({
    ...tr,
    members: tr.members.filter((m) => activePlayerNames.has(m.name)),
  }));

  return Response.json({
    wasReset,
    ...event,
    teamResults: filteredTeamResults,
    gameId: event.currentGameId ?? null,
    gameStatus,
    accessPassword: undefined, // never expose the hash
    hasPassword: !!event.accessPassword,
    ownerId: event.ownerId ?? null,
    ownerName: event.owner?.name ?? null,
    isAdmin,
    dateTime: event.dateTime.toISOString(),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    nextResetAt: event.nextResetAt?.toISOString() ?? null,
    archivedAt: event.archivedAt?.toISOString() ?? null,
    players: playersPayload,
  });
};
