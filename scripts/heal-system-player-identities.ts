/**
 * One-off (idempotent) corpus heal: detach synthetic ledger users
 * (`system:<eventId>:<name>`) from Player / EventPlayer / PlayerRating rows.
 *
 * Roster resolution once linked rows to those placeholders, which left the
 * human behind a name with no self-removal affordance — no Leave button, no X,
 * and `POST /leave` answering "You are not a player in this event."
 *
 * The synthetic User rows themselves stay: the wallet ledger keys on them.
 *
 * Usage:
 *   npx tsx scripts/heal-system-player-identities.ts          # dry run (report only)
 *   npx tsx scripts/heal-system-player-identities.ts --apply  # write
 */
import { prisma } from "../src/lib/db.server";
import { healSystemOwnedRosterIdentities } from "../src/lib/systemIdentityHeal.server";

async function main() {
  const apply = process.argv.includes("--apply");
  const report = await healSystemOwnedRosterIdentities(prisma, { dryRun: !apply });
  const total = report.players + report.eventPlayers + report.playerRatings;

  console.log(
    `${apply ? "Unlinked" : "Would unlink"} ${total} synthetic-owned row(s): ` +
      `players=${report.players} eventPlayers=${report.eventPlayers} playerRatings=${report.playerRatings}`,
  );
  if (!apply && total > 0) console.log("Dry run — re-run with --apply to write.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
