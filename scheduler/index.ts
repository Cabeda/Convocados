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

async function runLoop() {
  let pollInterval = POLL_IDLE_MS;
  let lastMaintenance = 0;
  let lastCourtWatch = 0;

  // eslint-disable-next-line no-constant-condition
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
