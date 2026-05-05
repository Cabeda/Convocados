import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  scheduleEventReminders,
  cancelEventJobs,
  getDueJobs,
  processJob,
} from "~/lib/scheduler.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock push and email modules
vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/email.server", () => ({
  sendReminder: vi.fn().mockResolvedValue(undefined),
  sendPaymentReminder: vi.fn().mockResolvedValue(undefined),
}));

// Mock notification queue
vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(0),
}));

// Import mocked modules so we can control their behavior in failure tests
import * as notificationQueue from "~/lib/notificationQueue.server";

async function seedUser(id = "user-sched-1") {
  return prisma.user.create({
    data: {
      id,
      name: "Scheduler User",
      email: `${id}@test.com`,
      emailVerified: true,
    },
  });
}

async function seedEvent(
  ownerId: string,
  dateTime: Date,
  id = "evt-sched-1",
  overrides: Partial<{ durationMinutes: number; title: string }> = {}
) {
  return prisma.event.create({
    data: {
      id,
      title: overrides.title ?? "Scheduler Game",
      location: "Test Field",
      dateTime,
      maxPlayers: 10,
      ownerId,
      durationMinutes: overrides.durationMinutes ?? 60,
    },
  });
}

beforeEach(async () => {
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

describe("scheduleEventReminders", () => {
  it("creates 24h, 2h, 1h and post-game reminder jobs", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-1", { durationMinutes: 60 });

    await scheduleEventReminders(event.id, eventDate, 60);

    const jobs = await prisma.scheduledJob.findMany({
      where: { eventId: event.id },
      orderBy: { runAt: "asc" },
    });

    expect(jobs).toHaveLength(4);
    expect(jobs.map((j) => j.type)).toEqual([
      "reminder_24h",
      "reminder_2h",
      "reminder_1h",
      "post_game",
    ]);

    // 24h reminder should be at eventDate - 24h
    const ms24h = 24 * 60 * 60 * 1000;
    expect(Math.abs(jobs[0].runAt.getTime() - (eventDate.getTime() - ms24h))).toBeLessThan(1000);

    // 2h reminder
    const ms2h = 2 * 60 * 60 * 1000;
    expect(Math.abs(jobs[1].runAt.getTime() - (eventDate.getTime() - ms2h))).toBeLessThan(1000);

    // 1h reminder
    const ms1h = 60 * 60 * 1000;
    expect(Math.abs(jobs[2].runAt.getTime() - (eventDate.getTime() - ms1h))).toBeLessThan(1000);

    // post-game reminder at eventDate + duration
    const msDuration = 60 * 60 * 1000;
    expect(Math.abs(jobs[3].runAt.getTime() - (eventDate.getTime() + msDuration))).toBeLessThan(1000);
  });

  it("does not create post-game job for zero-duration events", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-no-duration", { durationMinutes: 0 });

    await scheduleEventReminders(event.id, eventDate, 0);

    const jobs = await prisma.scheduledJob.findMany({ where: { eventId: event.id } });
    expect(jobs.map((j) => j.type)).not.toContain("post_game");
    expect(jobs).toHaveLength(3);
  });
});

describe("cancelEventJobs", () => {
  it("removes all pending jobs for an event", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-2");

    await scheduleEventReminders(event.id, eventDate, 60);
    await cancelEventJobs(event.id);

    const jobs = await prisma.scheduledJob.findMany({ where: { eventId: event.id } });
    expect(jobs).toHaveLength(0);
  });

  it("does not remove already-processed jobs", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-3");

    await scheduleEventReminders(event.id, eventDate, 60);
    await prisma.scheduledJob.updateMany({
      where: { eventId: event.id },
      data: { processedAt: new Date() },
    });

    await cancelEventJobs(event.id);

    const jobs = await prisma.scheduledJob.findMany({ where: { eventId: event.id } });
    expect(jobs).toHaveLength(4);
  });
});

describe("getDueJobs", () => {
  it("returns only jobs whose runAt is in the past and not processed", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-4");

    await scheduleEventReminders(event.id, eventDate, 60);

    // Fast-forward all jobs to be due
    await prisma.scheduledJob.updateMany({
      where: { eventId: event.id },
      data: { runAt: new Date(Date.now() - 1000) },
    });

    const due = await getDueJobs();
    expect(due).toHaveLength(4);
  });

  it("excludes jobs already processed", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-5");

    await scheduleEventReminders(event.id, eventDate, 60);
    await prisma.scheduledJob.updateMany({
      where: { eventId: event.id },
      data: { runAt: new Date(Date.now() - 1000), processedAt: new Date() },
    });

    const due = await getDueJobs();
    expect(due).toHaveLength(0);
  });

  it("excludes future jobs", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-6");

    await scheduleEventReminders(event.id, eventDate, 60);

    const due = await getDueJobs();
    expect(due).toHaveLength(0);
  });
});

describe("processJob", () => {
  it("marks a reminder job as processed and creates a reminderLog", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-7");
    await prisma.player.create({
      data: { name: "Player1", eventId: event.id, userId: user.id },
    });

    await scheduleEventReminders(event.id, eventDate, 60);
    const job = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "reminder_24h" },
    });
    expect(job).not.toBeNull();

    await processJob(job!.id);

    const updated = await prisma.scheduledJob.findUnique({ where: { id: job!.id } });
    expect(updated!.processedAt).not.toBeNull();

    const log = await prisma.reminderLog.findFirst({
      where: { eventId: event.id, type: "24h" },
    });
    expect(log).not.toBeNull();
  });

  it("marks a post-game job as processed", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-8");
    await prisma.player.create({
      data: { name: "Player1", eventId: event.id, userId: user.id },
    });

    await scheduleEventReminders(event.id, eventDate, 60);
    const job = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "post_game" },
    });
    expect(job).not.toBeNull();

    await processJob(job!.id);

    const updated = await prisma.scheduledJob.findUnique({ where: { id: job!.id } });
    expect(updated!.processedAt).not.toBeNull();

    const log = await prisma.reminderLog.findFirst({
      where: { eventId: event.id, type: "post-game" },
    });
    expect(log).not.toBeNull();
  });

  it("does nothing for non-existent job", async () => {
    await expect(processJob("non-existent-id")).resolves.not.toThrow();
  });

  it("throws and increments retryCount on failure", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-retry");
    await prisma.player.create({
      data: { name: "Player1", eventId: event.id, userId: user.id },
    });

    await scheduleEventReminders(event.id, eventDate, 60);
    const job = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "reminder_24h" },
    });
    expect(job).not.toBeNull();

    // Make notification queue fail
    vi.mocked(notificationQueue.enqueueNotification).mockRejectedValueOnce(
      new Error("Queue full")
    );

    await expect(processJob(job!.id)).rejects.toThrow("Queue full");

    const updated = await prisma.scheduledJob.findUnique({ where: { id: job!.id } });
    expect(updated!.processedAt).toBeNull();
    expect(updated!.failedAt).toBeNull();
    expect(updated!.retryCount).toBe(1);
  });

  it("marks job as failed after 3 retries", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, "evt-fail");
    await prisma.player.create({
      data: { name: "Player1", eventId: event.id, userId: user.id },
    });

    await scheduleEventReminders(event.id, eventDate, 60);
    const job = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "reminder_24h" },
    });
    expect(job).not.toBeNull();

    // Pre-set retry count to 2 so next failure exhausts retries
    await prisma.scheduledJob.update({
      where: { id: job!.id },
      data: { retryCount: 2 },
    });

    vi.mocked(notificationQueue.enqueueNotification).mockRejectedValueOnce(
      new Error("Queue full")
    );

    await expect(processJob(job!.id)).rejects.toThrow("Queue full");

    const updated = await prisma.scheduledJob.findUnique({ where: { id: job!.id } });
    expect(updated!.processedAt).toBeNull();
    expect(updated!.failedAt).not.toBeNull();
    expect(updated!.retryCount).toBe(2); // stays at 2, failedAt is set
  });
});
