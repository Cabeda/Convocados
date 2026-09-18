import { prisma } from "../src/lib/db.server";
import { recalculateAllRatings } from "../src/lib/elo.server";

/**
 * One-off migration step for the OpenSkill engine swap.
 *
 * Existing `PlayerRating.rating` values were produced by the old per-player Elo
 * engine. This replays every event's game history through OpenSkill, re-deriving
 * each player's `(ratingMu, ratingSigma)` and the projected `rating` from
 * scratch. Deterministic and idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/recompute-skill-ratings.ts [--dry-run]
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const events = await prisma.event.findMany({
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Recomputing Skill Ratings for ${events.length} event(s)${dryRun ? " [dry-run]" : ""}.`);

  let totalProcessed = 0;
  for (const event of events) {
    if (dryRun) {
      console.log(`  would recompute: ${event.title} (${event.id})`);
      continue;
    }
    try {
      const processed = await recalculateAllRatings(event.id);
      totalProcessed += processed;
      if (processed > 0) {
        console.log(`  ${event.title}: replayed ${processed} game(s)`);
      }
    } catch (error) {
      console.error(`  FAILED ${event.title} (${event.id}):`, error);
      process.exitCode = 1;
    }
  }

  if (!dryRun) {
    console.log(`Done. Replayed ${totalProcessed} game(s) across ${events.length} event(s).`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
