/**
 * Corpus heal for the roster-rows-owned-by-a-ledger-placeholder corruption.
 *
 * `src/lib/payerIdentity.server.ts` mints a synthetic User id
 * (`system:<eventId>:<name>`) for an unlinked player's money. Name-based roster
 * resolution used to treat that User as an account, so the Player / EventPlayer
 * / PlayerRating rows ended up "linked" to an id no human session can ever
 * match — and the human behind the name lost every self-removal affordance
 * (no Leave button, no X, and `POST /leave` answering 404). The resolution
 * paths are guarded now; this undoes the writes that already happened.
 *
 * The synthetic User rows themselves survive: the wallet ledger keys on them.
 */
import { prisma, Prisma } from "./db.server";
import { createLogger } from "./logger.server";

const log = createLogger("system-identity-heal");

type DbClient = Prisma.TransactionClient | typeof prisma;

export interface SystemIdentityHealReport {
  /** Legacy `Player` rows unlinked. */
  players: number;
  /** ADR 0016 `EventPlayer` rows unlinked. */
  eventPlayers: number;
  /** `PlayerRating` rows unlinked. */
  playerRatings: number;
}

export interface HealOptions {
  /** Count the affected rows without writing them. */
  dryRun?: boolean;
}

/** Detach every synthetic ledger user from the roster/rating rows it owns. */
export async function healSystemOwnedRosterIdentities(
  client: DbClient = prisma,
  opts: HealOptions = {},
): Promise<SystemIdentityHealReport> {
  const where = { userId: { startsWith: "system:" } };
  let players: number;
  let eventPlayers: number;
  let playerRatings: number;

  if (opts.dryRun) {
    [players, eventPlayers, playerRatings] = await Promise.all([
      client.player.count({ where }),
      client.eventPlayer.count({ where }),
      client.playerRating.count({ where }),
    ]);
  } else {
    const [playerRows, eventPlayerRows, ratingRows] = await client.$transaction([
      client.player.updateMany({ where, data: { userId: null } }),
      client.eventPlayer.updateMany({ where, data: { userId: null } }),
      client.playerRating.updateMany({ where, data: { userId: null } }),
    ]);
    players = playerRows.count;
    eventPlayers = eventPlayerRows.count;
    playerRatings = ratingRows.count;
  }

  const report: SystemIdentityHealReport = { players, eventPlayers, playerRatings };

  if (!opts.dryRun && players + eventPlayers + playerRatings > 0) {
    log.info({ ...report }, "Unlinked synthetic ledger users from roster/rating rows");
  }
  return report;
}
