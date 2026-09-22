/**
 * One-off backfill: collapse player identities that a *past* cross-account
 * merge left split (ADR 0040).
 *
 * `mergeUsers` used to repoint `userId` without touching the name-keyed player
 * rows (ADR 0016), so a merged user could still show up as two players in one
 * event (e.g. "José Cabeda" and "Cabeda"). `mergeUsers` now collapses these at
 * merge time; this script fixes merges that already happened.
 *
 *   npx tsx scripts/backfill-merged-player-identity.ts           # dry run
 *   npx tsx scripts/backfill-merged-player-identity.ts --apply   # write
 *
 * Idempotent: once collapsed, an event+user has a single name and is skipped.
 */
import { PrismaClient } from "@prisma/client";
import { findSplitIdentities, collapseSplitIdentities } from "../src/lib/backfillMergedIdentity.server";
import { recalculateAllRatings } from "../src/lib/elo.server";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  const identities = await findSplitIdentities(prisma);
  if (identities.length === 0) {
    console.log("No split player identities found. Nothing to do.");
    return;
  }

  console.log(`Found ${identities.length} split identity group(s):\n`);
  for (const id of identities) {
    console.log(`  event ${id.eventId}  user ${id.userId}`);
    console.log(`    ${id.sourceNames.join(", ")}  ->  ${id.targetName}`);
  }

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to collapse ${identities.length} group(s).`);
    return;
  }

  const processed = await collapseSplitIdentities(prisma, identities);

  const eventIds = [...new Set(identities.map((i) => i.eventId))];
  let recalculated = 0;
  for (const eventId of eventIds) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { eloEnabled: true } });
    if (event?.eloEnabled) {
      await recalculateAllRatings(eventId);
      recalculated++;
    }
  }

  console.log(`\n✓ Collapsed ${processed} identity group(s) across ${eventIds.length} event(s); recalculated ELO for ${recalculated}.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
