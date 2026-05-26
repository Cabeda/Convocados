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

async function runLoop() {
  let pollInterval = POLL_IDLE_MS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Date.now();
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
