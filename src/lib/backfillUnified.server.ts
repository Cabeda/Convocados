import { prisma } from "./db.server";

/**
 * Migrate the legacy snapshot model into the durable Game model (expand phase).
 *
 * For every GameHistory row, ensure the equivalent occurrence exists as a
 * `Game` and populate the durable rows that replace the two JSON blobs:
 *   - teamsSnapshot  → GameParticipant.team / .slot (+ Game formations)
 *   - paymentsSnapshot → GamePayment
 *   - MvpVote.gameHistoryId → MvpVote.gameId
 *
 * Idempotent and safe to re-run: a `Game` is matched by (eventId, dateTime) and
 * reused, participants are upserted, existing `GamePayment` rows always win
 * (the live settlement is authoritative), and MvpVote rows are linked only once.
 *
 * The GameHistory row itself is left intact — this is the expand half of an
 * expand/contract migration, so both models stay readable until readers move.
 */

interface SnapshotTeam {
  team?: string;
  formation?: string | null;
  players?: Array<{ name?: string; order?: number; slot?: number | null }>;
}

interface SnapshotPayment {
  playerName?: string;
  amount?: number;
  status?: string;
  method?: string | null;
}

export interface BackfillUnifiedResult {
  historiesScanned: number;
  gamesCreated: number;
  gamesReused: number;
  participantsUpserted: number;
  paymentsCreated: number;
  paymentsSkipped: number;
  votesLinked: number;
}

function emptyResult(): BackfillUnifiedResult {
  return {
    historiesScanned: 0,
    gamesCreated: 0,
    gamesReused: 0,
    participantsUpserted: 0,
    paymentsCreated: 0,
    paymentsSkipped: 0,
    votesLinked: 0,
  };
}

function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function ensureEventPlayer(eventId: string, name: string): Promise<string> {
  const trimmed = name.trim();
  const ep = await prisma.eventPlayer.upsert({
    where: { eventId_name: { eventId, name: trimmed } },
    create: { eventId, name: trimmed },
    update: {},
  });
  return ep.id;
}

interface HistoryRow {
  id: string;
  eventId: string;
  dateTime: Date;
  status: string;
  source: string;
  scoreOne: number | null;
  scoreTwo: number | null;
  scoreSets: string | null;
  isFriendly: boolean;
  eloProcessed: boolean;
  teamOneName: string;
  teamTwoName: string;
  teamsSnapshot: string | null;
  paymentsSnapshot: string | null;
}

async function backfillHistory(history: HistoryRow, result: BackfillUnifiedResult): Promise<void> {
  const teams = parseJson<SnapshotTeam[]>(history.teamsSnapshot) ?? [];
  const payments = parseJson<SnapshotPayment[]>(history.paymentsSnapshot) ?? [];

  const formationFor = (teamName: string): string | null => {
    const needle = teamName.trim().toLowerCase();
    const match = teams.find((t) => (t.team ?? "").trim().toLowerCase() === needle);
    return match?.formation ?? null;
  };

  // 1. Resolve or create the occurrence. A live played Game already exists for
  //    live histories; historical backfills have none.
  let game = await prisma.game.findFirst({
    where: { eventId: history.eventId, dateTime: history.dateTime },
    orderBy: { createdAt: "desc" },
  });

  if (!game) {
    game = await prisma.game.create({
      data: {
        eventId: history.eventId,
        dateTime: history.dateTime,
        status: history.status === "cancelled" ? "cancelled" : "played",
        source: history.source,
        scoreOne: history.scoreOne,
        scoreTwo: history.scoreTwo,
        scoreSets: history.scoreSets,
        isFriendly: history.isFriendly,
        eloProcessed: history.eloProcessed,
        teamOneName: history.teamOneName,
        teamTwoName: history.teamTwoName,
        teamOneFormation: formationFor(history.teamOneName),
        teamTwoFormation: formationFor(history.teamTwoName),
      },
    });
    result.gamesCreated++;
  } else {
    result.gamesReused++;
    // Fill only what the live Game is missing — never overwrite authoritative
    // live data with a stale snapshot.
    const patch: Record<string, unknown> = {};
    if (isNil(game.scoreOne) && !isNil(history.scoreOne)) patch.scoreOne = history.scoreOne;
    if (isNil(game.scoreTwo) && !isNil(history.scoreTwo)) patch.scoreTwo = history.scoreTwo;
    if (isNil(game.scoreSets) && !isNil(history.scoreSets)) patch.scoreSets = history.scoreSets;
    if (isNil(game.teamOneName) && history.teamOneName) patch.teamOneName = history.teamOneName;
    if (isNil(game.teamTwoName) && history.teamTwoName) patch.teamTwoName = history.teamTwoName;
    if (isNil(game.teamOneFormation)) patch.teamOneFormation = formationFor(history.teamOneName);
    if (isNil(game.teamTwoFormation)) patch.teamTwoFormation = formationFor(history.teamTwoName);
    if (Object.keys(patch).length > 0) {
      game = await prisma.game.update({ where: { id: game.id }, data: patch });
    }
  }

  // 2. Roster: teamsSnapshot → GameParticipant(team, slot, order).
  if (teams.length > 0) {
    let fallbackOrder = 0;
    for (const team of teams) {
      for (const player of team.players ?? []) {
        const name = player.name?.trim();
        if (!name) continue;
        const eventPlayerId = await ensureEventPlayer(history.eventId, name);
        await prisma.gameParticipant.upsert({
          where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId } },
          create: {
            gameId: game.id,
            eventPlayerId,
            order: player.order ?? fallbackOrder,
            team: team.team ?? null,
            slot: player.slot ?? null,
            status: "active",
          },
          update: {
            team: team.team ?? null,
            slot: player.slot ?? null,
            ...(!isNil(player.order) ? { order: player.order } : {}),
          },
        });
        fallbackOrder++;
        result.participantsUpserted++;
      }
    }
  }

  // 3. Payments: paymentsSnapshot → GamePayment. Existing (live settlement)
  //    rows always win; we never overwrite what the group already settled.
  if (payments.length > 0 && game.paymentMode !== "untracked") {
    for (const entry of payments) {
      const name = entry.playerName?.trim();
      if (!name) continue;
      const eventPlayerId = await ensureEventPlayer(history.eventId, name);
      const existing = await prisma.gamePayment.findUnique({
        where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId } },
      });
      if (existing) {
        result.paymentsSkipped++;
        continue;
      }
      await prisma.gamePayment.create({
        data: {
          gameId: game.id,
          eventPlayerId,
          playerName: name,
          amount: entry.amount ?? 0,
          status: entry.status ?? "pending",
          method: entry.method ?? null,
        },
      });
      result.paymentsCreated++;
    }
  }

  // 4. Link MVP votes to their Game. Historical votes carry no paidAt/markedBy
  //    fidelity loss — MvpVote only stores the identity references.
  const linked = await prisma.mvpVote.updateMany({
    where: { gameHistoryId: history.id, gameId: null },
    data: { gameId: game.id },
  });
  result.votesLinked += linked.count;
}

/**
 * Backfill the whole database, or a single event when `eventId` is given.
 * Returns counters for logging/verification.
 */
export async function backfillUnifiedModel(
  opts: { eventId?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<BackfillUnifiedResult> {
  const result = emptyResult();

  const histories = await prisma.gameHistory.findMany({
    where: opts.eventId ? { eventId: opts.eventId } : {},
    orderBy: { dateTime: "asc" },
    select: {
      id: true, eventId: true, dateTime: true, status: true, source: true,
      scoreOne: true, scoreTwo: true, scoreSets: true, isFriendly: true,
      eloProcessed: true, teamOneName: true, teamTwoName: true,
      teamsSnapshot: true, paymentsSnapshot: true,
    },
  });

  result.historiesScanned = histories.length;

  let done = 0;
  for (const history of histories) {
    await backfillHistory(history, result);
    done++;
    opts.onProgress?.(done, histories.length);
  }

  return result;
}
