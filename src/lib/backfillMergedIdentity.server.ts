import type { Prisma, PrismaClient } from "@prisma/client";
import { mergePlayerIdentity } from "./mergePlayer.server";

type Db = Prisma.TransactionClient | PrismaClient;

/** One event where a single user still shows up under more than one player name. */
export interface SplitIdentity {
  userId: string;
  eventId: string;
  /** Canonical name to keep — the user's account name. */
  targetName: string;
  /** Names to collapse into {@link targetName}. */
  sourceNames: string[];
}

/**
 * Find player identities that a *past* account merge left split: the same
 * `userId` owning more than one `EventPlayer.name` within one event. This is
 * the signature of an account merge that repointed `userId` but not the
 * name-keyed rows (`mergeUsers` now collapses these at merge time; this is the
 * backfill for merges that already happened).
 */
export async function findSplitIdentities(db: Db): Promise<SplitIdentity[]> {
  const eps = await db.eventPlayer.findMany({
    where: { userId: { not: null } },
    select: { eventId: true, name: true, userId: true },
  });

  const groups = new Map<string, { userId: string; eventId: string; names: Set<string> }>();
  for (const ep of eps) {
    if (!ep.userId) continue;
    const key = `${ep.eventId}::${ep.userId}`;
    let g = groups.get(key);
    if (!g) {
      g = { userId: ep.userId, eventId: ep.eventId, names: new Set() };
      groups.set(key, g);
    }
    g.names.add(ep.name);
  }

  const split = [...groups.values()].filter((g) => g.names.size > 1);
  if (split.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: [...new Set(split.map((s) => s.userId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return split
    .map((g) => {
      const [first] = [...g.names];
      const targetName = nameById.get(g.userId) ?? first ?? "";
      const sourceNames = [...g.names].filter((n) => n !== targetName);
      return { userId: g.userId, eventId: g.eventId, targetName, sourceNames };
    })
    .filter((s) => s.sourceNames.length > 0);
}

/**
 * Apply the collapses from {@link findSplitIdentities}. Returns the number of
 * identity groups processed. Does not recalc ELO — the caller does that per
 * affected event after committing.
 */
export async function collapseSplitIdentities(db: Db, identities: SplitIdentity[]): Promise<number> {
  let processed = 0;
  for (const identity of identities) {
    for (const sourceName of identity.sourceNames) {
      await mergePlayerIdentity(db, identity.eventId, sourceName, identity.targetName, identity.userId);
    }
    processed++;
  }
  return processed;
}

/**
 * Repair denormalized payment names that drifted from the linked player.
 *
 * `GamePayment.playerName` and the frozen `GameHistory.paymentsSnapshot` JSON
 * both duplicate the player name. A merge that repointed `userId` (or an early
 * collapse that only rewrote team snapshots) leaves them stale, so the history
 * and balance views still show the old name. `GamePayment` links to
 * `EventPlayer`, so the orphaned names can be recovered exactly.
 *
 * Returns the number of GamePayment rows corrected.
 */
export async function reconcilePaymentNames(db: Db): Promise<number> {
  const rows = await db.gamePayment.findMany({
    select: {
      id: true,
      playerName: true,
      game: { select: { eventId: true } },
      eventPlayer: { select: { name: true } },
    },
  });

  const fixesByEvent = new Map<string, Map<string, string>>();
  let corrected = 0;
  for (const row of rows) {
    const canonical = row.eventPlayer.name;
    if (row.playerName === canonical) continue;
    await db.gamePayment.update({ where: { id: row.id }, data: { playerName: canonical } });
    corrected++;
    let map = fixesByEvent.get(row.game.eventId);
    if (!map) {
      map = new Map();
      fixesByEvent.set(row.game.eventId, map);
    }
    map.set(row.playerName, canonical);
  }

  for (const [eventId, renames] of fixesByEvent) {
    const histories = await db.gameHistory.findMany({
      where: { eventId, paymentsSnapshot: { not: null } },
      select: { id: true, paymentsSnapshot: true },
    });
    for (const h of histories) {
      if (!h.paymentsSnapshot) continue;
      try {
        const entries = JSON.parse(h.paymentsSnapshot) as { playerName: string }[];
        let changed = false;
        for (const e of entries) {
          const to = renames.get(e.playerName);
          if (to) {
            e.playerName = to;
            changed = true;
          }
        }
        if (changed) {
          await db.gameHistory.update({ where: { id: h.id }, data: { paymentsSnapshot: JSON.stringify(entries) } });
        }
      } catch {
        // Malformed snapshot — leave it untouched.
      }
    }
  }

  return corrected;
}
