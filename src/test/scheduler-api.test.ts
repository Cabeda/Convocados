import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET as getDueJobs } from "~/pages/api/internal/jobs/due";
import { POST as processJob } from "~/pages/api/internal/jobs/[id]/process";
import { scheduleEventReminders } from "~/lib/scheduler.server";
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

import * as notificationQueue from "~/lib/notificationQueue.server";

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

async function seedUser(id = "user-int-1") {
  return prisma.user.create({
    data: {
      id,
      name: "Internal API User",
      email: `${id}@test.com`,
      emailVerified: true,
    },
  });
}

async function seedEvent(ownerId: string, dateTime: Date, id = "evt-int-1") {
  return prisma.event.create({
    data: {
      id,
      title: "Internal API Game",
      location: "Test Field",
      dateTime,
      maxPlayers: 10,
      ownerId,
      durationMinutes: 60,
    },
  });
}

describe("GET /api/internal/jobs/due", () => {
  it("returns 401 without valid scheduler secret", async () => {
    const res = await getDueJobs(ctx("GET", "/api/internal/jobs/due", { authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns empty array when no jobs are due", async () => {
    const res = await getDueJobs(ctx("GET", "/api/internal/jobs/due", { authorization: "Bearer test-scheduler-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toEqual([]);
  });

  it("returns due jobs", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-due");
    await scheduleEventReminders(event.id, eventDate, 60);

    // Fast-forward all jobs to be due
    await prisma.scheduledJob.updateMany({
      where: { eventId: event.id },
      data: { runAt: new Date(Date.now() - 1000) },
    });

    const res = await getDueJobs(ctx("GET", "/api/internal/jobs/due", { authorization: "Bearer test-scheduler-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toHaveLength(4);
  });
});

describe("POST /api/internal/jobs/:id/process", () => {
  it("returns 401 without valid scheduler secret", async () => {
    const res = await processJob(ctxWithParams("POST", "/api/internal/jobs/123/process", { id: "123" }, { authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("processes a due job", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-process");
    await prisma.player.create({ data: { name: "Player1", eventId: event.id, userId: user.id } });
    await scheduleEventReminders(event.id, eventDate, 60);

    const job = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "reminder_24h" },
    });
    expect(job).not.toBeNull();

    const res = await processJob(
      ctxWithParams("POST", `/api/internal/jobs/${job!.id}/process`, { id: job!.id }, {
        authorization: "Bearer test-scheduler-secret",
      })
    );
    expect(res.status).toBe(200);

    const updated = await prisma.scheduledJob.findUnique({ where: { id: job!.id } });
    expect(updated!.processedAt).not.toBeNull();
  });

  it("returns 400 when job id is missing", async () => {
    const res = await processJob(
      ctxWithParams("POST", "/api/internal/jobs//process", {}, {
        authorization: "Bearer test-scheduler-secret",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when job processing fails", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-process-fail");
    await prisma.player.create({ data: { name: "Player1", eventId: event.id, userId: user.id } });
    await scheduleEventReminders(event.id, eventDate, 60);

    const job = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "reminder_24h" },
    });
    expect(job).not.toBeNull();

    // Make notification queue fail to simulate a processing error
    vi.mocked(notificationQueue.enqueueNotification).mockRejectedValueOnce(
      new Error("Queue full")
    );

    const res = await processJob(
      ctxWithParams("POST", `/api/internal/jobs/${job!.id}/process`, { id: job!.id }, {
        authorization: "Bearer test-scheduler-secret",
      })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Queue full");
  });
});
