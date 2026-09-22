/**
 * One-off (idempotent) backfill: migrate GameHistory snapshots into the durable
 * Game model — Game, GameParticipant, GamePayment and MvpVote.gameId.
 *
 * Safe to run multiple times; existing GamePayment rows are never overwritten.
 *
 * Usage:
 *   npx tsx scripts/backfill-unified-game.ts            # all events
 *   npx tsx scripts/backfill-unified-game.ts <eventId>  # one event
 */
import { prisma } from "../src/lib/db.server";
import { backfillUnifiedModel } from "../src/lib/backfillUnified.server";

async function main() {
  const eventId = process.argv[2];
  if (eventId) console.log(`Backfilling event ${eventId}...`);
  else console.log("Backfilling all events...");

  const result = await backfillUnifiedModel({
    eventId,
    onProgress: (done, total) => {
      if (done % 50 === 0 || done === total) console.log(`  ${done}/${total}`);
    },
  });

  console.log("Done.", result);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
