/**
 * Prune dead-lettered ScheduledJob rows older than a cutoff (#1347).
 *
 * `/api/health` counts only failures inside FAILED_JOB_WINDOW_HOURS, so old
 * dead-letters no longer distort the number — they stay in the table for
 * diagnosis. This deletes the ones nobody will look at again, and prints what
 * it would remove unless `--apply` is passed.
 *
 *   sh scripts/with-env.sh tsx scripts/prune-dead-letters.ts
 *   sh scripts/with-env.sh tsx scripts/prune-dead-letters.ts --apply --older-than-days=30
 */
import { prisma } from "~/lib/db.server";

const days = Number(
  process.argv.find((a) => a.startsWith("--older-than-days="))?.split("=")[1] ?? 30,
);
const apply = process.argv.includes("--apply");
const cutoff = new Date(Date.now() - days * 86_400_000);
const where = { failedAt: { lt: cutoff } };

const rows = await prisma.scheduledJob.findMany({
  where,
  select: { id: true, type: true, failedAt: true },
  orderBy: { failedAt: "asc" },
});

console.log(`${rows.length} dead-letter(s) failed before ${cutoff.toISOString()}`);
for (const row of rows) console.log(`  ${row.id}  ${row.type}  ${row.failedAt?.toISOString()}`);

if (!apply) {
  console.log("dry run — pass --apply to delete");
} else {
  const { count } = await prisma.scheduledJob.deleteMany({ where });
  console.log(`deleted ${count}`);
}

await prisma.$disconnect();
