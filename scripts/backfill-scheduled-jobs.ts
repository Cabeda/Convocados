import { prisma } from "../src/lib/db.server";

/**
 * Backfill scheduled reminder jobs for all existing future events.
 *
 * This is a one-time script to run after deploying the scheduler worker.
 * It creates 24h, 2h, 1h and post-game reminder jobs for every event
 * whose dateTime is in the future and that doesn't already have scheduled jobs.
 *
 * Usage:
 *   npx tsx scripts/backfill-scheduled-jobs.ts [--dry-run]
 */

/** Reminder offsets in milliseconds */
const REMINDER_OFFSETS = {
  reminder_24h: 24 * 60 * 60 * 1000,
  reminder_2h: 2 * 60 * 60 * 1000,
  reminder_1h: 60 * 60 * 1000,
} as const;

async function scheduleEventReminders(
  eventId: string,
  dateTime: Date,
  durationMinutes: number
) {
  const jobs = [
    { type: "reminder_24h", runAt: new Date(dateTime.getTime() - REMINDER_OFFSETS.reminder_24h) },
    { type: "reminder_2h", runAt: new Date(dateTime.getTime() - REMINDER_OFFSETS.reminder_2h) },
    { type: "reminder_1h", runAt: new Date(dateTime.getTime() - REMINDER_OFFSETS.reminder_1h) },
  ];

  if (durationMinutes > 0) {
    jobs.push({
      type: "post_game",
      runAt: new Date(dateTime.getTime() + durationMinutes * 60 * 1000),
    });
  }

  await prisma.scheduledJob.createMany({
    data: jobs.map((j) => ({
      eventId,
      type: j.type,
      runAt: j.runAt,
      payload: "{}",
    })),
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const events = await prisma.event.findMany({
    where: { dateTime: { gt: new Date() } },
    select: {
      id: true,
      dateTime: true,
      durationMinutes: true,
      title: true,
    },
  });

  // Find events that already have scheduled jobs
  const eventIdsWithJobs = new Set(
    (
      await prisma.scheduledJob.findMany({
        where: { eventId: { in: events.map((e) => e.id) } },
        select: { eventId: true },
      })
    )
      .map((j) => j.eventId)
      .filter(Boolean) as string[],
  );

  const eventsToBackfill = events.filter((e) => !eventIdsWithJobs.has(e.id));

  console.log(`Found ${events.length} future events, ${eventsToBackfill.length} need backfilling`);

  if (eventsToBackfill.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (dryRun) {
    console.log("\nDry run — no changes will be made.\n");
    for (const event of eventsToBackfill) {
      console.log(`  Would schedule: ${event.title} (${event.id}) at ${event.dateTime.toISOString()}`);
    }
    return;
  }

  let success = 0;
  let failed = 0;

  for (const event of eventsToBackfill) {
    try {
      await scheduleEventReminders(event.id, event.dateTime, event.durationMinutes ?? 0);
      console.log(`✓ Scheduled reminders for: ${event.title} (${event.id})`);
      success++;
    } catch (err) {
      console.error(`✗ Failed to schedule ${event.id}:`, err);
      failed++;
    }
  }

  console.log(`\nDone: ${success} scheduled, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
