import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET as getDueJobs } from "~/pages/api/internal/jobs/due";
import { POST as processJob } from "~/pages/api/internal/jobs/[id]/process";
import { scheduleEventReminders, processJob as processJobDirect } from "~/lib/scheduler.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/email.server", () => ({
  sendReminder: vi.fn().mockResolvedValue(undefined),
  sendPaymentReminder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(0),
}));

const OLD_SCHEDULER_SECRET = process.env.SCHEDULER_SECRET;

beforeEach(async () => {
  process.env.SCHEDULER_SECRET = "test-scheduler-secret";
  await prisma.scheduledJob.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

afterEach(() => {
  process.env.SCHEDULER_SECRET = OLD_SCHEDULER_SECRET;
});

function ctx(method: string, path: string, headers?: Record<string, string>) {
  return {
    request: new Request(`http://localhost${path}`, {
      method,
      headers: headers ?? {},
    }),
    params: {},
    url: new URL(`http://localhost${path}`),
  } as any;
}

function ctxWithParams(method: string, path: string, params: Record<string, string>, headers?: Record<string, string>) {
  return {
    request: new Request(`http://localhost${path}`, {
      method,
      headers: headers ?? {},
    }),
    params,
    url: new URL(`http://localhost${path}`),
  } as any;
}

async function seedUser(id = "user-e2e-1") {
  return prisma.user.create({
    data: {
      id,
      name: "E2E User",
      email: `${id}@test.com`,
      emailVerified: true,
    },
  });
}

async function seedEvent(ownerId: string, dateTime: Date, id = "evt-e2e-1") {
  return prisma.event.create({
    data: {
      id,
      title: "E2E Game",
      location: "Test Field",
      dateTime,
      maxPlayers: 10,
      ownerId,
      durationMinutes: 60,
    },
  });
}

describe("Scheduler end-to-end flow", () => {
  it("full cycle: poll due jobs → process via API → mark processed", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-e2e-cycle");
    await prisma.player.create({ data: { name: "Player1", eventId: event.id, userId: user.id } });

    await scheduleEventReminders(event.id, eventDate, 60);

    // Fast-forward all jobs to be due
    await prisma.scheduledJob.updateMany({
      where: { eventId: event.id },
      data: { runAt: new Date(Date.now() - 1000) },
    });

    // Step 1: Scheduler polls for due jobs
    const dueRes = await getDueJobs(
      ctx("GET", "/api/internal/jobs/due", { authorization: "Bearer test-scheduler-secret" })
    );
    expect(dueRes.status).toBe(200);
    const { jobs } = await dueRes.json();
    expect(jobs).toHaveLength(4);

    // Step 2: Scheduler processes each job via the API
    for (const job of jobs) {
      const processRes = await processJob(
        ctxWithParams("POST", `/api/internal/jobs/${job.id}/process`, { id: job.id }, {
          authorization: "Bearer test-scheduler-secret",
        })
      );
      expect(processRes.status).toBe(200);
      const body = await processRes.json();
      expect(body.ok).toBe(true);
    }

    // Step 3: Verify all jobs are marked processed
    const remaining = await prisma.scheduledJob.findMany({
      where: { eventId: event.id, processedAt: null },
    });
    expect(remaining).toHaveLength(0);

    // Step 4: Verify reminder logs were created
    const logs = await prisma.reminderLog.findMany({ where: { eventId: event.id } });
    expect(logs.map((l) => l.type).sort()).toEqual(["24h", "2h", "post-game", "1h"].sort());
  });

  it("handles API 500 by leaving job unprocessed for retry", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-e2e-retry");
    await prisma.player.create({ data: { name: "Player1", eventId: event.id, userId: user.id } });

    await scheduleEventReminders(event.id, eventDate, 60);

    // Create a duplicate reminderLog to force unique constraint violation
    await prisma.reminderLog.create({
      data: { eventId: event.id, type: "24h" },
    });

    await prisma.scheduledJob.updateMany({
      where: { eventId: event.id },
      data: { runAt: new Date(Date.now() - 1000) },
    });

    // Poll for due jobs
    const dueRes = await getDueJobs(
      ctx("GET", "/api/internal/jobs/due", { authorization: "Bearer test-scheduler-secret" })
    );
    const { jobs } = await dueRes.json();
    const job24h = jobs.find((j: { type: string }) => j.type === "reminder_24h");
    expect(job24h).toBeDefined();

    // Process via API — should return 500
    const processRes = await processJob(
      ctxWithParams("POST", `/api/internal/jobs/${job24h.id}/process`, { id: job24h.id }, {
        authorization: "Bearer test-scheduler-secret",
      })
    );
    expect(processRes.status).toBe(500);
    const body = await processRes.json();
    expect(body.ok).toBe(false);

    // Job should be left unprocessed with retryCount incremented
    const updated = await prisma.scheduledJob.findUnique({ where: { id: job24h.id } });
    expect(updated!.processedAt).toBeNull();
    expect(updated!.retryCount).toBe(1);
  });

  it("marks job as failed after 3 API 500s", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-e2e-fail");
    await prisma.player.create({ data: { name: "Player1", eventId: event.id, userId: user.id } });

    await scheduleEventReminders(event.id, eventDate, 60);

    // Create a duplicate reminderLog to force failure
    await prisma.reminderLog.create({
      data: { eventId: event.id, type: "24h" },
    });

    const job = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "reminder_24h" },
    });
    expect(job).not.toBeNull();

    // Pre-set retry count to 2
    await prisma.scheduledJob.update({
      where: { id: job!.id },
      data: { retryCount: 2, runAt: new Date(Date.now() - 1000) },
    });

    // Call API — this is the 3rd failure
    const processRes = await processJob(
      ctxWithParams("POST", `/api/internal/jobs/${job!.id}/process`, { id: job!.id }, {
        authorization: "Bearer test-scheduler-secret",
      })
    );
    expect(processRes.status).toBe(500);

    // Job should be marked as failed
    const updated = await prisma.scheduledJob.findUnique({ where: { id: job!.id } });
    expect(updated!.failedAt).not.toBeNull();
    expect(updated!.processedAt).toBeNull();

    // Polling again should not return this job
    const dueRes = await getDueJobs(
      ctx("GET", "/api/internal/jobs/due", { authorization: "Bearer test-scheduler-secret" })
    );
    const { jobs } = await dueRes.json();
    const found = jobs.find((j: { id: string }) => j.id === job!.id);
    expect(found).toBeUndefined();
  });

  it("direct processJob call throws to signal failure to caller", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-direct-fail");
    await prisma.player.create({ data: { name: "Player1", eventId: event.id, userId: user.id } });

    await scheduleEventReminders(event.id, eventDate, 60);

    // Create duplicate log to trigger failure
    await prisma.reminderLog.create({
      data: { eventId: event.id, type: "24h" },
    });

    const job = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "reminder_24h" },
    });
    expect(job).not.toBeNull();

    await expect(processJobDirect(job!.id)).rejects.toThrow();

    const updated = await prisma.scheduledJob.findUnique({ where: { id: job!.id } });
    expect(updated!.processedAt).toBeNull();
    expect(updated!.retryCount).toBe(1);
  });
});
