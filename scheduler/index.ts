/**
 * Convocados Scheduler Worker
 *
 * A lightweight polling worker that runs as a separate Fly machine.
 * It polls the web app's internal API for due scheduled jobs and
 * processes them one at a time.
 *
 * Environment variables:
 *   APP_URL          - Web app base URL (e.g. https://convocados.fly.dev)
 *   SCHEDULER_SECRET - Shared secret for internal API auth
 *   POLL_INTERVAL_MS - Polling interval in ms (default: 10000)
 */

import { setTimeout } from "node:timers/promises";

const APP_URL = process.env.APP_URL ?? "https://convocados.fly.dev";
const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "10000", 10);

interface Job {
  id: string;
  eventId: string | null;
  type: string;
  runAt: string;
}

async function fetchDueJobs(): Promise<Job[]> {
  const res = await fetch(`${APP_URL}/api/internal/jobs/due`, {
    headers: {
      authorization: `Bearer ${SCHEDULER_SECRET}`,
    },
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
    headers: {
      authorization: `Bearer ${SCHEDULER_SECRET}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to process job ${jobId}: ${res.status} ${res.statusText}`);
  }
}

async function runLoop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Date.now();
    try {
      const jobs = await fetchDueJobs();
      if (jobs.length > 0) {
        console.log(`[scheduler] Found ${jobs.length} due job(s)`);
      }

      for (const job of jobs) {
        try {
          await processJob(job.id);
          console.log(`[scheduler] Processed job ${job.id} (${job.type})`);
        } catch (err) {
          console.error(`[scheduler] Failed to process job ${job.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[scheduler] Polling error:", err);
    }

    const elapsed = Date.now() - start;
    const sleep = Math.max(0, POLL_INTERVAL_MS - elapsed);
    await setTimeout(sleep);
  }
}

// Validate config before starting
if (!SCHEDULER_SECRET) {
  console.error("[scheduler] SCHEDULER_SECRET is required");
  process.exit(1);
}

console.log(`[scheduler] Starting — polling ${APP_URL}/api/internal/jobs/due every ${POLL_INTERVAL_MS}ms`);
runLoop().catch((err) => {
  console.error("[scheduler] Fatal error:", err);
  process.exit(1);
});
