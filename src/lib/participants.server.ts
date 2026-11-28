import { prisma, type Prisma } from "./db.server";
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
  return linkedPlayerForRoster(latestHistory?.teamsSnapshot, linked);
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

/** One occurrence for a batched settled-game read. */
export interface SettledOccurrence {
  key: string;
  event: SettledGameParticipantContext["event"];
  latestHistory: SettledGameParticipantContext["latestHistory"];
}

/**
 * Resolve each occurrence's Game the way `settledGame` does, in one read:
 * currentGameId before a reset, otherwise the latest Game at the history's
 * dateTime.
 */
async function resolveOccurrenceGames(
  occurrences: SettledOccurrence[],
): Promise<Map<string, string | null>> {
  const currentGameIds = new Set<string>();
  const dates = new Map<string, { eventId: string; dateTime: Date }>();
  const usesCurrent = new Set<string>();
  for (const o of occurrences) {
    const hasReset = !!o.latestHistory && o.event.dateTime.getTime() > o.latestHistory.dateTime.getTime();
    if (!hasReset && o.event.currentGameId) {
      usesCurrent.add(o.key);
      currentGameIds.add(o.event.currentGameId);
    } else {
      const dateTime = o.latestHistory?.dateTime ?? o.event.dateTime;
      dates.set(`${o.event.id}:${dateTime.getTime()}`, { eventId: o.event.id, dateTime });
    }
  }

  const or: Prisma.GameWhereInput[] = [];
  if (currentGameIds.size > 0) or.push({ id: { in: [...currentGameIds] } });
  for (const { eventId, dateTime } of dates.values()) or.push({ eventId, dateTime });

  const games = or.length
    ? await prisma.game.findMany({
        where: { OR: or },
        orderBy: { createdAt: "desc" },
        select: { id: true, eventId: true, dateTime: true },
      })
    : [];
  const byId = new Map(games.map((g) => [g.id, g]));
  const byEventDate = new Map<string, string>();
  for (const g of games) {
    const key = `${g.eventId}:${g.dateTime.getTime()}`;
    if (!byEventDate.has(key)) byEventDate.set(key, g.id);
  }

  const out = new Map<string, string | null>();
  for (const o of occurrences) {
    if (usesCurrent.has(o.key)) {
      const game = o.event.currentGameId ? byId.get(o.event.currentGameId) : undefined;
      out.set(o.key, game && game.eventId === o.event.id ? game.id : null);
    } else {
      const dateTime = o.latestHistory?.dateTime ?? o.event.dateTime;
      out.set(o.key, byEventDate.get(`${o.event.id}:${dateTime.getTime()}`) ?? null);
    }
  }
  return out;
}

/** The frozen-name bridge to the account's linked EventPlayer, or null. */
function linkedPlayerForRoster(
  teamsSnapshot: string | null | undefined,
  linked: readonly SettledGameEventPlayer[],
): SettledGameEventPlayer | null {
  const needle = new Set(namesFromTeamsSnapshot(teamsSnapshot).map(normalizeName));
  if (needle.size === 0) return null;
  return linked.find((p) => needle.has(normalizeName(p.name))) ?? null;
}

function legacyEligibleVoterCount(
  teamsSnapshot: string | null | undefined,
  linked: readonly { name: string }[],
): number {
  const needle = new Set(namesFromTeamsSnapshot(teamsSnapshot).map(normalizeName));
  if (needle.size === 0) return 0;
  return new Set(linked.filter((p) => needle.has(normalizeName(p.name))).map((p) => normalizeName(p.name))).size;
}

interface SettledOccurrenceRoster {
  gameId: string | null;
  durable: boolean;
  participants: Array<{ eventPlayer: { id: string; name: string; userId: string | null } }>;
  linked: Array<{ id: string; name: string; userId: string | null }>;
}

/**
 * Resolve many occurrences at once: the Game, its durable roster rows, and the
 * event's linked EventPlayers for the legacy bridge. Shared by the eligible
 * voter count and the per-viewer player lookup so both answer the same way.
 */
async function settledOccurrenceRosters(
  occurrences: SettledOccurrence[],
): Promise<Map<string, SettledOccurrenceRoster>> {
  const out = new Map<string, SettledOccurrenceRoster>();
  if (occurrences.length === 0) return out;

  const gameByKey = await resolveOccurrenceGames(occurrences);
  const gameIds = [...new Set([...gameByKey.values()].filter((id): id is string => !!id))];
  const eventIds = [...new Set(occurrences.map((o) => o.event.id))];

  const [participants, onRoll, payers, linked] = await Promise.all([
    gameIds.length
      ? prisma.gameParticipant.findMany({
          where: { gameId: { in: gameIds }, archivedAt: null, status: { not: "pending" } },
          select: { gameId: true, eventPlayer: { select: { id: true, name: true, userId: true } } },
        })
      : Promise.resolve([] as Array<{ gameId: string; eventPlayer: { id: string; name: string; userId: string | null } }>),
    gameIds.length
      ? prisma.gamePayment.findMany({
          where: { gameId: { in: gameIds }, archivedAt: null },
          select: { gameId: true },
          distinct: ["gameId"],
        })
      : Promise.resolve([] as Array<{ gameId: string }>),
    gameIds.length
      ? prisma.game.findMany({
          where: { id: { in: gameIds }, payerEventPlayerId: { not: null } },
          select: { id: true },
        })
      : Promise.resolve([] as Array<{ id: string }>),
    prisma.eventPlayer.findMany({
      where: { eventId: { in: eventIds }, userId: { not: null } },
      select: { eventId: true, id: true, name: true, userId: true },
    }),
  ]);

  const durable = new Set<string>();
  for (const row of participants) durable.add(row.gameId);
  for (const row of onRoll) durable.add(row.gameId);
  for (const row of payers) durable.add(row.id);

  const participantsByGame = new Map<string, SettledOccurrenceRoster["participants"]>();
  for (const row of participants) {
    const list = participantsByGame.get(row.gameId) ?? [];
    list.push({ eventPlayer: row.eventPlayer });
    participantsByGame.set(row.gameId, list);
  }
  const linkedByEvent = new Map<string, SettledOccurrenceRoster["linked"]>();
  for (const p of linked) {
    const list = linkedByEvent.get(p.eventId) ?? [];
    list.push({ id: p.id, name: p.name, userId: p.userId });
    linkedByEvent.set(p.eventId, list);
  }

  for (const o of occurrences) {
    const gameId = gameByKey.get(o.key) ?? null;
    out.set(o.key, {
      gameId,
      durable: !!gameId && durable.has(gameId),
      participants: gameId ? participantsByGame.get(gameId) ?? [] : [],
      linked: linkedByEvent.get(o.event.id) ?? [],
    });
  }
  return out;
}

/**
 * Batched `settledGameEligibleVoters`: distinct linked EventPlayers on the
 * durable rows, never a name.
 */
export async function settledGameEligibleVotersByOccurrence(
  occurrences: SettledOccurrence[],
): Promise<Map<string, number>> {
  const rosters = await settledOccurrenceRosters(occurrences);
  const out = new Map<string, number>();
  for (const o of occurrences) {
    const roster = rosters.get(o.key)!;
    if (roster.gameId) {
      const voters = new Set(
        roster.participants.map((p) => p.eventPlayer.userId).filter((id): id is string => !!id),
      );
      out.set(o.key, voters.size);
    } else {
      out.set(o.key, legacyEligibleVoterCount(o.latestHistory?.teamsSnapshot, roster.linked));
    }
  }
  return out;
}

/**
 * Batched `settledGamePlayer`: the linked EventPlayer a given account played as,
 * per occurrence, without a query per game.
 */
export async function settledGamePlayersByOccurrence(
  occurrences: SettledOccurrence[],
  userId: string,
): Promise<Map<string, SettledGameEventPlayer | null>> {
  const rosters = await settledOccurrenceRosters(occurrences);
  const out = new Map<string, SettledGameEventPlayer | null>();
  if (!userId) {
    for (const o of occurrences) out.set(o.key, null);
    return out;
  }
  for (const o of occurrences) {
    const roster = rosters.get(o.key)!;
    const onTeam = roster.gameId
      ? roster.participants.find((p) => p.eventPlayer.userId === userId)?.eventPlayer
      : undefined;
    if (onTeam) {
      out.set(o.key, { id: onTeam.id, name: onTeam.name });
    } else if (roster.gameId && roster.durable) {
      out.set(o.key, null);
    } else {
      out.set(
        o.key,
        linkedPlayerForRoster(
          o.latestHistory?.teamsSnapshot,
          roster.linked.filter((p) => p.userId === userId),
        ),
      );
    }
  }
  return out;
}

/**
 * How many accounts can vote on the settled game: distinct linked EventPlayers
 * on its teams. Anonymous roster rows cannot vote, so they are not counted;
 * User.name never decides who is eligible.
 */
export async function settledGameEligibleVoters(
  context: Pick<SettledGameParticipantContext, "event" | "latestHistory">,
): Promise<number> {
  const counts = await settledGameEligibleVotersByOccurrence([
    { key: "occurrence", event: context.event, latestHistory: context.latestHistory },
  ]);
  return counts.get("occurrence") ?? 0;
}
