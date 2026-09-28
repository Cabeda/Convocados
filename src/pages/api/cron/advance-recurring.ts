import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { requireCronSecret } from "~/lib/cronAuth.server";
import { advanceDueRecurringEvent } from "~/lib/advanceOccurrence.server";
import { createLogger } from "~/lib/logger.server";

const log = createLogger("cron:advance-recurring");

/** Cap per sweep so one run can't hold a request open; stragglers catch the next tick. */
const SWEEP_LIMIT = 20;

/**
 * Eager occurrence advance (issue #1176): recurring events currently only
 * roll forward when someone GETs the event page (lazy reset), which leaves
 * them missing from Discover and their next-occurrence reminders un-armed
 * until the next visit. This sweep runs every 5 minutes from the scheduler
 * worker and drives the same CAS advance path, so recurring-stays-listed is
 * exact without mutating on a read path.
 */
export const POST: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
  const denied = requireCronSecret(request, cronSecret);
  if (denied) return denied;

  const due = await prisma.event.findMany({
    where: {
      isRecurring: true,
      archivedAt: null,
      recurrenceRule: { not: null },
      nextResetAt: { lte: new Date() },
    },
    include: { teamResults: { include: { members: true } } },
    orderBy: { nextResetAt: "asc" },
    take: SWEEP_LIMIT,
  });

  let advanced = 0;
  let failed = 0;
  for (const event of due) {
    try {
      const result = await advanceDueRecurringEvent(event);
      if (result === "advanced") advanced++;
    } catch (err) {
      failed++;
      log.error({ eventId: event.id, err }, "failed to advance recurring occurrence");
    }
  }

  return Response.json({ ok: true, examined: due.length, advanced, failed });
};
