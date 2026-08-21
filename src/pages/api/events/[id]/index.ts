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
      players: { where: { archivedAt: null }, orderBy: { order: "asc" }, include: { user: { select: { image: true } } } },
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
        // Payment overhaul: carry paymentMode to the next occurrence; carry the
        // payer only if they were an active participant of the previous game.
        const oldGameId = event.currentGameId;
        let inheritMode: string | null = null;
        let inheritPayerId: string | null = null;
        if (oldGameId) {
          const oldGame = await prisma.game.findUnique({
            where: { id: oldGameId },
            select: { paymentMode: true, payerEventPlayerId: true },
          });
          inheritMode = oldGame?.paymentMode ?? null;
          if (oldGame?.payerEventPlayerId) {
            const payerStillActive = await prisma.gameParticipant.findFirst({
              where: { gameId: oldGameId, eventPlayerId: oldGame.payerEventPlayerId, archivedAt: null },
              select: { id: true },
            });
            if (payerStillActive) inheritPayerId = oldGame.payerEventPlayerId;
          }
        }
        const newGame = await prisma.game.create({
          data: {
            eventId: event.id,
            dateTime: newDateTime,
            status: "upcoming",
            paymentMode: inheritMode,
            payerEventPlayerId: inheritPayerId,
          },
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

        // Payment overhaul: reconcile the new game's payment rows (no-op until
        // the roster is populated, but keeps carried-over payments in sync).
        import("../../../../lib/settlement.server")
          .then(({ syncGamePayments }) => syncGamePayments(newGame.id, event.id))
          .catch(() => {});

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
  // Hoisted for the ADR 0025 invited/declined gating below (separate if-block).
  let pendingParticipants: Array<{ eventPlayer: { id: string; name: string; userId: string | null; invitationOptOutAt: Date | null; eventId: string }; order: number; createdAt: Date; status: string }> = [];
  let playersByName = new Map<string, string | null>();
  let imageByUserId = new Map<string, string | null>();
  if (event.currentGameId) {
    const participants = await prisma.gameParticipant.findMany({
      where: { gameId: event.currentGameId, archivedAt: null },
      include: { eventPlayer: true },
      orderBy: { order: "asc" },
    });

    // ponytail: EventPlayer.userId may be stale (null) if the player rejoined
    // after a reset and the upsert didn't update it. Fall back to the event-level
    // Player.userId which is the authoritative link.
    playersByName = new Map(
      event.players
        .filter((p) => p.userId)
        .map((p) => [p.name, p.userId]),
    );

    // ADR 0025: pending invite entries (status="pending") are roster ghosts —
    // shown separately as "invited", excluded from playersPayload so they never
    // pollute roster/bench counts, payments or team draws.
    const activeParticipants = participants.filter((gp) => gp.status !== "pending");
    pendingParticipants = participants.filter((gp) => gp.status === "pending");

    // EventPlayer has no Prisma relation to User, so resolve profile images in
    // one batch query keyed by the resolved userId (account-linked identity).
    const linkedUserIds = [...new Set(participants.map((gp) => gp.eventPlayer.userId ?? playersByName.get(gp.eventPlayer.name)))].filter((u): u is string => !!u);
    const linkedUsers = linkedUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: linkedUserIds } }, select: { id: true, image: true } })
      : [];
    imageByUserId = new Map(linkedUsers.map((u) => [u.id, u.image]));

    playersPayload = activeParticipants.map((gp) => {
      const userId = gp.eventPlayer.userId ?? playersByName.get(gp.eventPlayer.name) ?? null;
      return {
        id: gp.eventPlayer.id,
        name: gp.eventPlayer.name,
        order: gp.order,
        eventId: gp.eventPlayer.eventId,
        userId,
        image: userId ? (imageByUserId.get(userId) ?? null) : null,
        createdAt: gp.createdAt.toISOString(),
        invitationOptOutAt: gp.eventPlayer.invitationOptOutAt?.toISOString() ?? null,
      };
    });
  } else {
    playersPayload = event.players.map(({ user, ...p }) => ({
      ...p,
      userId: p.userId ?? null,
      image: user?.image ?? null,
      createdAt: p.createdAt.toISOString(),
      invitationOptOutAt: null,
    }));
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

  // ADR 0025: declined roster (rsvp=no on the current game) + pending invitees —
  // both read-only, visible to participants + owner + admins only (plus the
  // invitee's own pending entry). Anonymous/followers get [].
  let declined: Array<{ id: string; name: string; userId: string | null; image: string | null }> = [];
  let invited: Array<{ id: string; name: string; userId: string | null; image: string | null }> = [];
  if (event.currentGameId) {
    const sessionForViewer = await getSession(request).catch(() => null);
    const viewerId = sessionForViewer?.user?.id ?? null;

    let viewerIsParticipant = false;
    let viewerIsAdmin = false;
    let viewerHasPendingHere = false;
    if (viewerId) {
      viewerIsParticipant = playersPayload.some((p) => p.userId === viewerId)
        || pendingParticipants.some((gp) => (gp.eventPlayer.userId ?? playersByName.get(gp.eventPlayer.name)) === viewerId);
      if (event.ownerId === viewerId) {
        viewerIsAdmin = true;
      } else {
        try {
          const isAdminResult = await checkEventAdmin(event.id, viewerId);
          viewerIsAdmin = isAdminResult === true;
        } catch {
          viewerIsAdmin = false;
        }
      }
      viewerHasPendingHere = pendingParticipants.some((gp) => (gp.eventPlayer.userId ?? playersByName.get(gp.eventPlayer.name)) === viewerId);
    }
    const viewerSeesRosterExtras = !!viewerId && (viewerIsParticipant || viewerIsAdmin);

    if (viewerSeesRosterExtras) {
      const declinedRsvps = await prisma.rsvp.findMany({
        where: { gameId: event.currentGameId, status: "no" },
        select: { eventPlayerId: true },
      });
      if (declinedRsvps.length > 0) {
        const declinedEps = await prisma.eventPlayer.findMany({
          where: { id: { in: declinedRsvps.map((r) => r.eventPlayerId) } },
          select: { id: true, name: true, userId: true },
        });
        const declinedUserIds = declinedEps.map((e) => e.userId).filter((u): u is string => !!u);
        const declinedUsers = declinedUserIds.length
          ? await prisma.user.findMany({ where: { id: { in: declinedUserIds } }, select: { id: true, image: true } })
          : [];
        const declinedImageByUserId = new Map(declinedUsers.map((u) => [u.id, u.image]));
        declined = declinedEps.map((e) => ({
          id: e.id,
          name: e.name,
          userId: e.userId,
          image: e.userId ? (declinedImageByUserId.get(e.userId) ?? null) : null,
        }));
      }
    }

    // The invitee's own pending entry is always visible to them.
    if (viewerId && (viewerSeesRosterExtras || viewerHasPendingHere)) {
      invited = pendingParticipants.map((gp) => {
        const userId = gp.eventPlayer.userId ?? playersByName.get(gp.eventPlayer.name) ?? null;
        return {
          id: gp.eventPlayer.id,
          name: gp.eventPlayer.name,
          userId,
          image: userId ? (imageByUserId.get(userId) ?? null) : null,
        };
      });
    }
  }

  // ADR 0016: filter teamResults to only include members in the current game's player list.
  // After a recurrence reset, old team members linger in TeamResult but the player list
  // is now game-scoped via GameParticipant. Only show team members who are active players.
  // Teams that end up with no active members are dropped entirely: a Teams section with
  // empty rosters is never meaningful, and UIs use this array to decide whether teams exist.
  const activePlayerNames = new Set(playersPayload.map((p: { name: string }) => p.name));
  const filteredTeamResults = event.teamResults
    .map((tr) => ({
      ...tr,
      members: tr.members.filter((m) => activePlayerNames.has(m.name)),
    }))
    .filter((tr) => tr.members.length > 0);

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
    declined,
    invited,
  });
};
