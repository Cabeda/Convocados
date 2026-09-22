import type { APIRoute } from "astro";
import { requireCronSecret } from "~/lib/cronAuth.server";
import { backfillUnifiedModel } from "~/lib/backfillUnified.server";

/**
 * One-shot unified-model backfill — the expand-phase data migration that fills
 * `Game` / `GameParticipant` / `GamePayment` / `MvpVote.gameId` from the legacy
 * `GameHistory` snapshots.
 *
 * Idempotent (a `Game` is matched by eventId+dateTime, existing `GamePayment`
 * rows always win), so it is safe to invoke repeatedly. Guarded by CRON_SECRET
 * like the other `/api/cron/*` routes and driven from the scheduler, because the
 * production image ships only `dist` and cannot run the tsx script.
 *
 * POST /api/cron/backfill-unified[?eventId=<id>]
 */
export const POST: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
  const denied = requireCronSecret(request, cronSecret);
  if (denied) return denied;

  const eventId = new URL(request.url).searchParams.get("eventId") ?? undefined;
  const result = await backfillUnifiedModel({ eventId });

  return Response.json({ ok: true, eventId: eventId ?? null, ...result });
};
