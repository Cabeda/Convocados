/**
 * One-off backfill: copy all PlayerRating rows into EventPlayer.
 * Safe to run multiple times (upserts by eventId+name).
 *
 * Usage: npx tsx scripts/backfill-event-players.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const ratings = await prisma.playerRating.findMany();
  console.log(`Found ${ratings.length} PlayerRating rows to backfill.`);

  let created = 0;
  let skipped = 0;

  for (const r of ratings) {
    try {
      await prisma.eventPlayer.upsert({
        where: { eventId_name: { eventId: r.eventId, name: r.name } },
        create: {
          eventId: r.eventId,
          name: r.name,
          userId: r.userId,
          rating: r.rating,
          gamesPlayed: r.gamesPlayed,
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
        },
        update: {
          // Update stats if EventPlayer already exists but has stale data
          userId: r.userId ?? undefined,
          rating: r.rating,
          gamesPlayed: r.gamesPlayed,
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
        },
      });
      created++;
    } catch (e: any) {
      console.warn(`  Skip ${r.name} (event ${r.eventId}): ${e.message}`);
      skipped++;
    }
  }

  console.log(`Done. Created/updated: ${created}, skipped: ${skipped}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
