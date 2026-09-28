import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { advanceDueRecurringEvent } from "../../../../lib/advanceOccurrence.server";
import { getSession, checkEventAdmin } from "../../../../lib/auth.helpers.server";
import { checkAccess } from "../../../../lib/eventAccess";
import { computePostGameStatus } from "../../../../lib/postgame.server";
import { activeParticipantsWhere } from "../../../../lib/activeParticipants.server";

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

    // Invite link bypass: a valid PlayerInvite token for this event unlocks the page.
    // This lets an organizer share the event link with ?inviteToken=xxx to skip the
    // password, and the EventPage will show an Accept/Decline banner.
    let hasValidInviteToken = false;
    try {
      const inviteToken = new URL(request.url).searchParams.get("inviteToken");
      if (inviteToken) {
        const invite = await prisma.playerInvite.findUnique({
          where: { token: inviteToken },
          select: {
            eventPlayer: { select: { eventId: true } },
            game: { select: { eventId: true } },
          },
        });
        if (invite && (invite.eventPlayer.eventId === event.id || invite.game?.eventId === event.id)) {
          hasValidInviteToken = true;
        }
      }
    } catch {
      // ignore malformed URL or DB errors — fall through to password gate
    }

    const access = checkAccess({
      eventOwnerId: event.ownerId,
      accessPassword: event.accessPassword,
      requestUserId: session?.user?.id ?? null,
      cookieHeader: request.headers.get("cookie"),
      eventId: event.id,
      isInvited: isInvited || isEventAdmin || hasValidInviteToken,
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

  // Lazy recurrence reset — the CAS advance lives in advanceDueRecurringEvent,
  // shared with the cron sweep (issue #1176) so visits aren't the only trigger.
  const advance = await advanceDueRecurringEvent(event);
  if (advance !== "not-due") {
    if (advance === "advanced") wasReset = true;
    // Reload so the response reflects the new occurrence — also when a
    // concurrent caller won the CAS (state already moved under us).
    const fresh = await prisma.event.findUnique({
      where: { id: event.id },
      include: {
        players: { where: { archivedAt: null }, orderBy: { order: "asc" } },
        teamResults: { include: { members: { orderBy: { order: "asc" } } } },
      },
    });
    if (fresh) Object.assign(event, fresh);
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
    // Use shared helper for active roster (status != pending) and a parallel
    // query for pending ghosts (ADR 0025). Single where shape kept in one place (#803).
    const [activeParticipants, pendingRows] = await Promise.all([
      prisma.gameParticipant.findMany({
        where: activeParticipantsWhere(event.currentGameId),
        include: { eventPlayer: true },
        orderBy: { order: "asc" },
      }),
      prisma.gameParticipant.findMany({
        where: { gameId: event.currentGameId, archivedAt: null, status: "pending" },
        include: { eventPlayer: true },
        orderBy: { order: "asc" },
      }),
    ]);
    pendingParticipants = pendingRows;
    const participants = [...activeParticipants, ...pendingRows].sort((a, b) => a.order - b.order);

    // ponytail: EventPlayer.userId may be stale (null) if the player rejoined
    // after a reset and the upsert didn't update it. Fall back to the event-level
    // Player.userId which is the authoritative link.
    playersByName = new Map(
      event.players
        .filter((p) => p.userId)
        .map((p) => [p.name, p.userId]),
    );

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
  let invited: Array<{
    id: string;
    name: string;
    userId: string | null;
    image: string | null;
    channels: { email: boolean; webPush: boolean; appPush: boolean };
    notifiedAt: string | null;
  }> = [];
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
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
      const proto = request.headers.get("x-forwarded-proto") ?? "https";
      const origin = `${proto}://${host}`;
      // ADR 0025 follow-up: attach the persisted per-invite delivery channels
      // (email / web push / app push) + last-notified time so admins can see
      // how an invite was sent and when a resend becomes available.
      const pendingInviteRows = await prisma.playerInvite.findMany({
        where: { gameId: event.currentGameId, status: "pending" },
        select: {
          id: true,
          eventPlayerId: true,
          token: true,
          notifiedAt: true,
          sentViaEmail: true,
          sentViaWebPush: true,
          sentViaAppPush: true,
        },
      });
      const inviteByEventPlayerId = new Map(pendingInviteRows.map((pi) => [pi.eventPlayerId, pi]));
      // Invariant heal (ADR 0025): a pending GameParticipant without a pending
      // PlayerInvite is an orphan ghost left by expiry/merge/retract races.
      // Delete it instead of rendering an "Invited" chip with a null inviteId
      // that can never be retracted ("Invite not found or no longer pending.").
      const orphanEpIds = pendingParticipants
        .filter((gp) => !inviteByEventPlayerId.has(gp.eventPlayer.id))
        .map((gp) => gp.eventPlayer.id);
      if (orphanEpIds.length > 0) {
        await prisma.gameParticipant
          .deleteMany({ where: { gameId: event.currentGameId, eventPlayerId: { in: orphanEpIds }, status: "pending" } })
          .catch(() => {});
      }
      invited = pendingParticipants
        .filter((gp) => inviteByEventPlayerId.has(gp.eventPlayer.id))
        .map((gp) => {
        const userId = gp.eventPlayer.userId ?? playersByName.get(gp.eventPlayer.name) ?? null;
        const pi = inviteByEventPlayerId.get(gp.eventPlayer.id);
        return {
          id: gp.eventPlayer.id,
          inviteId: pi?.id ?? null,
          inviteUrl: pi?.token ? `${origin}/invite/${pi.token}` : null,
          name: gp.eventPlayer.name,
          userId,
          image: userId ? (imageByUserId.get(userId) ?? null) : null,
          channels: {
            email: pi?.sentViaEmail ?? false,
            webPush: pi?.sentViaWebPush ?? false,
            appPush: pi?.sentViaAppPush ?? false,
          },
          notifiedAt: pi?.notifiedAt?.toISOString() ?? null,
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

  // Post-game wrap-up status rides the initial payload so the UI can decide
  // whether to render the post-game banner without flashing it and hiding it
  // after a client-side fetch resolves. Only computed for authenticated
  // viewers — anonymous visitors never see the banner (isParticipant=false),
  // so the extra queries would be wasted on every public/crawler request.
  const viewerSession = await getSession(request).catch(() => null);
  const postGameStatus = viewerSession?.user
    ? await computePostGameStatus(params.id!, request)
    : null;

  return Response.json({
    wasReset,
    ...event,
    postGameStatus,
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
