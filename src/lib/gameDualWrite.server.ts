import { prisma } from "~/lib/db.server";

type Db = Pick<typeof prisma, "game" | "gameHistory" | "gameParticipant" | "eventPlayer" | "gamePayment">;

type SnapshotTeam = {
  team?: string;
  formation?: string | null;
  players?: { name?: string; order?: number; slot?: number | null }[];
};

type SnapshotPayment = {
  playerName?: string;
  amount?: number;
  status?: string;
  method?: string | null;
};

function isNil(v: unknown): boolean {
  return v === null || v === undefined;
}

async function ensureEventPlayerId(eventId: string, name: string, db: Db): Promise<string> {
  const trimmed = name.trim();
  const ep = await db.eventPlayer.upsert({
    where: { eventId_name: { eventId, name: trimmed } },
    create: { eventId, name: trimmed },
    update: {},
  });
  return ep.id;
}

function parseSnapshot<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve the Game row that mirrors a history entry: prefer id equality
 * (GameHistory.id === Game.id worlds), fall back to the occurrence dateTime
 * (backfill/materialise worlds keep separate cuids).
 */
export async function resolveMirrorGame(
  eventId: string,
  historyId: string,
  dateTime: Date,
  db: Db = prisma,
): Promise<{ id: string; dateTime: Date; paymentMode: string | null } | null> {
  const byId = await db.game.findUnique({ where: { id: historyId, eventId } });
  if (byId) return byId;
  return db.game.findFirst({
    where: { eventId, dateTime },
    orderBy: { createdAt: "desc" },
    select: { id: true, dateTime: true, paymentMode: true },
  });
}

/**
 * Write a teamsSnapshot onto its occurrence Game: durable team names +
 * formations, GameParticipant team/slot/order (upsert like the unified
 * backfill, then clear stale assignments no longer in the snapshot), and any
 * already-materialized GameHistory row for the same occurrence.
 */
export async function applyTeamsSnapshotToGame(
  game: { id: string; eventId: string; dateTime: Date },
  rawSnapshot: string | null,
  db: Db = prisma,
): Promise<void> {
  const teams = parseSnapshot<SnapshotTeam[]>(rawSnapshot);
  if (!teams?.length) return;

  const teamOne = teams[0];
  const teamTwo = teams[1];
  await db.game.update({
    where: { id: game.id },
    data: {
      ...(teamOne?.team ? { teamOneName: teamOne.team } : {}),
      ...(teamTwo?.team ? { teamTwoName: teamTwo.team } : {}),
      ...(teamOne && !isNil(teamOne.formation) ? { teamOneFormation: teamOne.formation } : {}),
      ...(teamTwo && !isNil(teamTwo.formation) ? { teamTwoFormation: teamTwo.formation } : {}),
    },
  });

  const syncedIds: string[] = [];
  let fallbackOrder = 0;
  for (const team of teams) {
    for (const player of team.players ?? []) {
      const name = player.name?.trim();
      if (!name) continue;
      const eventPlayerId = await ensureEventPlayerId(game.eventId, name, db);
      syncedIds.push(eventPlayerId);
      await db.gameParticipant.upsert({
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
    }
  }

  // Clear assignments for participants no longer listed in the snapshot
  // (moved to bench, removed) so GameParticipant.team never goes stale.
  await db.gameParticipant.updateMany({
    where: {
      gameId: game.id,
      team: { not: null },
      ...(syncedIds.length ? { eventPlayerId: { notIn: syncedIds } } : {}),
    },
    data: { team: null, slot: null },
  });

  if (teamOne?.team || teamTwo?.team) {
    await db.gameHistory.updateMany({
      where: { eventId: game.eventId, dateTime: game.dateTime },
      data: {
        teamsSnapshot: rawSnapshot ?? undefined,
        ...(teamOne?.team ? { teamOneName: teamOne.team } : {}),
        ...(teamTwo?.team ? { teamTwoName: teamTwo.team } : {}),
      },
    });
  }
}

/**
 * Dual-write a fresh teamResult draw (teams PUT/PATCH, randomize) onto the
 * occurrence Game: rebuild the canonical snapshot shape from teamResults and
 * apply it.
 */
export async function syncGameFromTeamResults(
  game: { id: string; eventId: string; dateTime: Date },
  teamResults: {
    name: string;
    formation: string | null;
    members: { name: string; order: number; slot: number | null }[];
  }[],
  db: Db = prisma,
): Promise<void> {
  if (!teamResults.length) return;
  const snapshot = teamResults.map((tr) => ({
    team: tr.name,
    formation: tr.formation,
    players: tr.members.map((m) => ({ name: m.name, order: m.order, slot: m.slot })),
  }));
  await applyTeamsSnapshotToGame(game, JSON.stringify(snapshot), db);
}

/**
 * Mirror an edited paymentsSnapshot onto GamePayment rows. Live settlement
 * (GamePayment) stays authoritative for rows the snapshot does not mention;
 * entries present in the snapshot are written through (the edit was explicit).
 * Untracked games never gain rows (matching the unified backfill).
 */
export async function mirrorPaymentsSnapshotToGame(
  game: { id: string; paymentMode?: string | null },
  rawSnapshot: string | null,
  eventId: string,
  db: Db = prisma,
): Promise<void> {
  const payments = parseSnapshot<SnapshotPayment[]>(rawSnapshot);
  if (!payments?.length) return;
  if (game.paymentMode === "untracked") return;

  for (const entry of payments) {
    const name = entry.playerName?.trim();
    if (!name) continue;
    const eventPlayerId = await ensureEventPlayerId(eventId, name, db);
    const amount = entry.amount ?? 0;
    const status = entry.status ?? "pending";
    const method = entry.method ?? null;
    const existing = await db.gamePayment.findUnique({
      where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId } },
    });
    if (existing) {
      await db.gamePayment.update({
        where: { id: existing.id },
        data: { amount, status, method },
      });
    } else {
      await db.gamePayment.create({
        data: { gameId: game.id, eventPlayerId, playerName: name, amount, status, method },
      });
    }
  }
}
