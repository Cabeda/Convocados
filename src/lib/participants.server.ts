import { prisma } from "./db.server";
import { namesFromTeamsSnapshot, normalizeName } from "./snapshotParticipants";
import { activeParticipantsWhere } from "./activeParticipants.server";

export interface SettledGameParticipantContext {
  sessionUser: { id?: string; name?: string | null } | null;
  event: { id: string; dateTime: Date; currentGameId?: string | null };
  latestHistory: {
    teamsSnapshot: string | null;
    dateTime: Date;
  } | null;
}

interface SettledGameEventPlayer {
  id: string;
  name: string;
}

/**
 * The Game row for the settled occurrence: the live currentGameId before a
 * reset, otherwise the one matching the latest history's dateTime. This is the
 * same occurrence rule the payment roll and roster readers use.
 */
async function settledGame(
  event: SettledGameParticipantContext["event"],
  occurrenceDt: Date,
  hasReset: boolean,
): Promise<{ id: string } | null> {
  if (!hasReset && event.currentGameId) {
    return prisma.game.findFirst({
      where: { id: event.currentGameId, eventId: event.id },
      select: { id: true },
    });
  }
  return prisma.game.findFirst({
    where: { eventId: event.id, dateTime: occurrenceDt },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

/**
 * Whether the occurrence already has durable roster/payment rows. Only when it
 * has none may the frozen names bridge a legacy row to the linked account.
 */
async function hasDurableRows(gameId: string): Promise<boolean> {
  const onTeams = await prisma.gameParticipant.findFirst({
    where: activeParticipantsWhere(gameId),
    select: { id: true },
  });
  if (onTeams) return true;

  const onRoll = await prisma.gamePayment.findFirst({
    where: { gameId, archivedAt: null },
    select: { id: true },
  });
  if (onRoll) return true;

  const payer = await prisma.game.findFirst({
    where: { id: gameId, payerEventPlayerId: { not: null } },
    select: { id: true },
  });
  return !!payer;
}

/**
 * The one seam that answers "is this account part of the settled game?".
 *
 * Identity is the linked EventPlayer (userId), never the session's User.name:
 * a user can rename themselves to any 50-char string, so a name match would let
 * anyone rewrite a settled game's score, teams, payments and MVP vote. The
 * frozen snapshot and payment-roll names are only used to bridge legacy rows to
 * the linked EventPlayer — its userId still decides.
 */
async function settledGameEventPlayer(
  context: SettledGameParticipantContext,
  includePayments: boolean,
): Promise<SettledGameEventPlayer | null> {
  const { sessionUser, event, latestHistory } = context;
  const userId = sessionUser?.id;
  if (!userId) return null;

  const occurrenceDt = latestHistory?.dateTime ?? event.dateTime;
  const hasReset = !!latestHistory && event.dateTime.getTime() > latestHistory.dateTime.getTime();
  const game = await settledGame(event, occurrenceDt, hasReset);

  if (game) {
    const onTeams = await prisma.gameParticipant.findFirst({
      where: { ...activeParticipantsWhere(game.id), eventPlayer: { userId } },
      select: { eventPlayer: { select: { id: true, name: true } } },
    });
    if (onTeams) return onTeams.eventPlayer;

    if (includePayments) {
      const onRoll = await prisma.gamePayment.findFirst({
        where: { gameId: game.id, archivedAt: null, eventPlayer: { userId } },
        select: { eventPlayer: { select: { id: true, name: true } } },
      });
      if (onRoll) return onRoll.eventPlayer;

      const asPayer = await prisma.game.findFirst({
        where: { id: game.id, payerEventPlayer: { is: { userId } } },
        select: { payerEventPlayer: { select: { id: true, name: true } } },
      });
      if (asPayer?.payerEventPlayer) return asPayer.payerEventPlayer;
    }
  }

  // Only a legacy occurrence with no durable rows at all may bridge through
  // the frozen names. When durable rows exist, a name in a stale snapshot must
  // not override the roster: an absent player is absent, not re-authorized.
  if (game && (await hasDurableRows(game.id))) return null;

  // Legacy rows with no durable link: match the frozen roster names to the
  // account's own EventPlayer, then trust only that row's userId.
  const linked = await prisma.eventPlayer.findMany({
    where: { eventId: event.id, userId },
    select: { id: true, name: true },
  });
  if (linked.length === 0) return null;

  const rosterNames = namesFromTeamsSnapshot(latestHistory?.teamsSnapshot);
  if (rosterNames.length > 0) {
    const needle = new Set(rosterNames.map(normalizeName));
    const match = linked.find((p) => needle.has(normalizeName(p.name)));
    if (match) return match;
  }

  return null;
}

/**
 * Whether the current user is a participant of the settled game, i.e. involved
 * in settling it (score, payments). A user counts when their linked EventPlayer
 * is on the settled game's teams or payment roll (ADR 0016) — never by the
 * self-editable User.name.
 *
 * Owner/Admin override is intentionally NOT handled here — callers decide
 * whether to grant settlement roles regardless of participation.
 */
export async function isSettledGameParticipant(context: SettledGameParticipantContext): Promise<boolean> {
  return (await settledGameEventPlayer(context, true)) !== null;
}

/** The linked EventPlayer who played the settled game, or null. */
export async function settledGamePlayer(
  context: SettledGameParticipantContext,
): Promise<SettledGameEventPlayer | null> {
  return settledGameEventPlayer(context, false);
}

/**
 * How many accounts can vote on the settled game: distinct linked EventPlayers
 * on its teams. Anonymous roster rows cannot vote, so they are not counted;
 * User.name never decides who is eligible.
 */
export async function settledGameEligibleVoters(
  context: Pick<SettledGameParticipantContext, "event" | "latestHistory">,
): Promise<number> {
  const { event, latestHistory } = context;
  const occurrenceDt = latestHistory?.dateTime ?? event.dateTime;
  const hasReset = !!latestHistory && event.dateTime.getTime() > latestHistory.dateTime.getTime();
  const game = await settledGame(event, occurrenceDt, hasReset);

  if (game) {
    const rows = await prisma.gameParticipant.findMany({
      where: activeParticipantsWhere(game.id),
      select: { eventPlayer: { select: { userId: true } } },
    });
    const voters = new Set<string>();
    for (const row of rows) {
      if (row.eventPlayer.userId) voters.add(row.eventPlayer.userId);
    }
    return voters.size;
  }

  const rosterNames = namesFromTeamsSnapshot(latestHistory?.teamsSnapshot);
  if (rosterNames.length === 0) return 0;
  const needle = new Set(rosterNames.map(normalizeName));
  const linked = await prisma.eventPlayer.findMany({
    where: { eventId: event.id, userId: { not: null } },
    select: { name: true },
  });
  return new Set(
    linked.filter((p) => needle.has(normalizeName(p.name))).map((p) => normalizeName(p.name)),
  ).size;
}
