import type { APIRoute } from "astro";
import { runDbOptimize } from "~/lib/db.server";
import { requireCronSecret } from "~/lib/cronAuth.server";

/**
 * Daily DB maintenance — runs `PRAGMA optimize` to keep SQLite query plans
 * fresh. Invoked by the scheduler worker (long-lived process) via HTTP, so the
 * app itself needs no long-running timer: it wakes on request, runs optimize,
 * and suspends again (auto_stop_machines).
 */
export const POST: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
  const denied = requireCronSecret(request, cronSecret);
  if (denied) return denied;

  await runDbOptimize();
  return Response.json({ ok: true });
};