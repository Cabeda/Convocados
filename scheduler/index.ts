/**
 * Convocados Scheduler Worker
 *
 * A lightweight polling worker that runs as a separate Fly machine.
 * It polls the web app's internal API for due scheduled jobs and
 * processes them in parallel batches.
 *
 * Environment variables:
 *   APP_URL          - Web app base URL (e.g. https://convocados.fly.dev)
 *   SCHEDULER_SECRET - Shared secret for internal API auth
 *   CONCURRENCY      - Max parallel job processing (default: 3)
 */

import { setTimeout } from "node:timers/promises";

const APP_URL = process.env.APP_URL ?? "https://convocados.fly.dev";
const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET;
const CRON_SECRET = process.env.CRON_SECRET ?? SCHEDULER_SECRET;
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "3", 10);
const FETCH_TIMEOUT_MS = 30_000;

/** Adaptive polling: 5s when active, 30s when idle */
const POLL_ACTIVE_MS = 5_000;
const POLL_IDLE_MS = 30_000;

interface Job {
  id: string;
  eventId: string | null;
  type: string;
  runAt: string;
}

async function fetchDueJobs(): Promise<Job[]> {
  const res = await fetch(`${APP_URL}/api/internal/jobs/due`, {
    headers: { authorization: `Bearer ${SCHEDULER_SECRET}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch due jobs: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { jobs: Job[] };
  return body.jobs ?? [];
}

async function processJob(jobId: string): Promise<void> {
  const res = await fetch(`${APP_URL}/api/internal/jobs/${jobId}/process`, {
    method: "POST",
    headers: { authorization: `Bearer ${SCHEDULER_SECRET}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Failed to process job ${jobId}: ${res.status} ${res.statusText}`);
  }
}

/** Interval for periodic maintenance (rate limit cleanup, stale tokens, etc.) */
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Interval for court-watch sweep (hourly) */
const COURT_WATCH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/** Interval for SQLite maintenance — PRAGMA optimize (daily, per SQLite docs) */
const DB_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Interval for the eager recurring-occurrence advance sweep (issue #1176) */
const RECURRING_ADVANCE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Interval for the pending-invite expiry sweep (GH #1273). Invites for games
 * that have kicked off are expired by the lazy path only when someone opens
 * the current game, so stale occurrences need a sweep of their own.
 */
const INVITE_EXPIRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** UTC hours the Open Pickup sweep runs (ADR-0021: twice daily) */
const PICKUP_SWEEP_HOURS = [9, 21];

async function triggerMaintenance(): Promise<void> {
  const res = await fetch(`${APP_URL}/api/cron/reminders`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Maintenance cron failed: ${res.status} ${res.statusText}`);
  }

  const body = await res.json() as Record<string, unknown>;
  console.log("[scheduler] Maintenance completed:", JSON.stringify(body));
}

async function triggerCourtWatch(): Promise<void> {
  const res = await fetch(`${APP_URL}/api/cron/court-watch`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Court-watch cron failed: ${res.status} ${res.statusText}`);
  }

  const body = await res.json() as Record<string, unknown>;
  console.log("[scheduler] Court-watch completed:", JSON.stringify(body));
}

async function triggerDbMaintenance(): Promise<void> {
  const res = await fetch(`${APP_URL}/api/cron/db-maintenance`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`DB maintenance cron failed: ${res.status} ${res.statusText}`);
  }

  const body = await res.json() as Record<string, unknown>;
  console.log("[scheduler] DB maintenance completed:", JSON.stringify(body));
}

/**
 * POST one internal cron endpoint and log what it reports.
 *
 * Every trigger is the same request — POST, bearer token, timeout, throw on a
 * non-2xx — so they differ only in the path, the label used in the error and
 * log lines, and which body counts are worth reporting. `countKeys` names the
 * counts that earn a log line when non-zero; an empty list logs every pass.
 */
async function triggerCron(
  path: string,
  label: string,
  countKeys: readonly string[] = [],
): Promise<void> {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`${label} cron failed: ${res.status} ${res.statusText}`);
  }

  const body = await res.json() as Record<string, unknown>;
  if (countKeys.length === 0 || countKeys.some((key) => Number(body[key] ?? 0) > 0)) {
    console.log(`[scheduler] ${label} completed:`, JSON.stringify(body));
  }
}

const triggerPickupSweep = (): Promise<void> => triggerCron("/api/cron/pickups", "Pickup sweep");

const triggerRecurringAdvance = (): Promise<void> =>
  triggerCron("/api/cron/advance-recurring", "Recurring advance", ["advanced", "failed"]);

const triggerInviteExpiry = (): Promise<void> =>
  triggerCron("/api/cron/invite-expiry", "Invite expiry", ["expired"]);

/**
 * Run one periodic trigger at most once per `intervalMs`, and only while
 * `gate` allows — the pickup sweep is pinned to fixed UTC hours. Failures are
 * logged and swallowed so a broken cron cannot stall the loop, and the stamp
 * advances only on success, so a failing trigger is retried on the next tick
 * rather than being skipped for a whole interval.
 */
async function runTick(
  trigger: () => Promise<void>,
  label: string,
  intervalMs: number,
  last: number,
  now: number,
  gate?: () => boolean,
): Promise<number> {
  if (now - last < intervalMs) return last;
  if (gate && !gate()) return last;

  try {
    await trigger();
  } catch (err) {
    console.error(`[scheduler] ${label} error:`, err);
    return last;
  }
  return now;
}

async function runLoop() {
  // No initialiser: every branch of the poll below assigns before the value is
  // read, so seeding it with POLL_IDLE_MS would be a dead assignment.
  let pollInterval: number;
  let lastMaintenance = 0;
  let lastCourtWatch = 0;
  let lastDbMaintenance = 0;
  let lastPickupSweep = 0;
  let lastRecurringAdvance = 0;
  let lastInviteExpiry = 0;

  while (true) {
    const start = Date.now();

    // Periodic maintenance: cleanup + fallback reminder delivery
    if (start - lastMaintenance >= MAINTENANCE_INTERVAL_MS) {
      try {
        await triggerMaintenance();
        lastMaintenance = start;
      } catch (err) {
        console.error("[scheduler] Maintenance error:", err);
      }
    }

    // Hourly court-watch sweep
    if (start - lastCourtWatch >= COURT_WATCH_INTERVAL_MS) {
      try {
        await triggerCourtWatch();
        lastCourtWatch = start;
      } catch (err) {
        console.error("[scheduler] Court-watch error:", err);
      }
    }

    // Daily SQLite maintenance (PRAGMA optimize) — runs in the app on request;
    // the worker only holds the timer, so the app needs no long-lived process.
    if (start - lastDbMaintenance >= DB_MAINTENANCE_INTERVAL_MS) {
      try {
        await triggerDbMaintenance();
        lastDbMaintenance = start;
      } catch (err) {
        console.error("[scheduler] DB maintenance error:", err);
      }
    }

    // Twice-daily Open Pickup sweep (09:00 / 21:00 UTC, at most once per hour).
    lastPickupSweep = await runTick(
      triggerPickupSweep,
      "Pickup sweep",
      60 * 60 * 1000,
      lastPickupSweep,
      start,
      () => PICKUP_SWEEP_HOURS.includes(new Date().getUTCHours()),
    );

    // Eager recurring-occurrence advance (issue #1176) — keeps recurring
    // events listed on Discover and next-occurrence reminders armed without
    // waiting for someone to open the event page.
    lastRecurringAdvance = await runTick(
      triggerRecurringAdvance, "Recurring advance", RECURRING_ADVANCE_INTERVAL_MS, lastRecurringAdvance, start,
    );

    // Eager pending-invite expiry (GH #1273) — keeps "Invited" pills from
    // living on past occurrences, which no read path can reach.
    lastInviteExpiry = await runTick(
      triggerInviteExpiry, "Invite expiry", INVITE_EXPIRY_INTERVAL_MS, lastInviteExpiry, start,
    );

    try {
      const jobs = await fetchDueJobs();

      if (jobs.length > 0) {
        console.log(`[scheduler] Found ${jobs.length} due job(s)`);
        pollInterval = POLL_ACTIVE_MS;

        // Process in parallel batches of CONCURRENCY
        for (let i = 0; i < jobs.length; i += CONCURRENCY) {
          const batch = jobs.slice(i, i + CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(async (job) => {
              await processJob(job.id);
              console.log(`[scheduler] Processed job ${job.id} (${job.type})`);
            }),
          );
          for (const r of results) {
            if (r.status === "rejected") {
              console.error("[scheduler] Job failed:", r.reason);
            }
          }
        }
      } else {
        pollInterval = POLL_IDLE_MS;
      }
    } catch (err) {
      console.error("[scheduler] Polling error:", err);
      pollInterval = POLL_IDLE_MS;
    }

    const elapsed = Date.now() - start;
    const sleep = Math.max(0, pollInterval - elapsed);
    await setTimeout(sleep);
  }
}

// Validate config before starting
if (!SCHEDULER_SECRET) {
  console.error("[scheduler] SCHEDULER_SECRET is required");
  process.exit(1);
}

console.log(`[scheduler] Starting — concurrency=${CONCURRENCY}, active=${POLL_ACTIVE_MS}ms, idle=${POLL_IDLE_MS}ms`);
runLoop().catch((err) => {
  console.error("[scheduler] Fatal error:", err);
  process.exit(1);
});
