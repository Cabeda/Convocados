/**
 * #1775 — a notification that exhausts its retries must leave a readout.
 *
 * The outbox is how players hear a game exists, so a dead-lettered push is the
 * moment the app silently stops telling them. Before this change the row was
 * only written and pruned: /api/health counted ScheduledJob failures only, the
 * admin failure table read ScheduledJob only, and the drain returned
 * `jobs.length` so a fully dead-lettered batch logged the same number as a
 * clean one.
 *
 * Seam under test: the drain's public result, GET /api/health, and the admin
 * stats payload — the three places a human or the probe reads a failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const sendPushToEvent = vi.fn().mockRejectedValue(new Error("fcm down"));
vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: (...args: unknown[]) => sendPushToEvent(...args),
}));

import { drainNotificationQueue } from "~/lib/notificationQueue.server";
import { GET as health } from "~/pages/api/health";
import { getAdminStats } from "~/lib/admin.server";

const EVENT_ID = "evt-dead-letter-visibility";

async function seedEvent() {
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Dead Letter",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
    },
  });
}

async function seedExhaustedJob(failedAt?: Date) {
  return prisma.notificationJob.create({
    data: {
      eventId: EVENT_ID,
      type: "player_joined",
      payload: JSON.stringify({
        title: "Dead Letter",
        key: "notifyPlayerJoined",
        params: { name: "Ana" },
        url: `/events/${EVENT_ID}`,
        spotsLeft: 3,
      }),
      retryCount: 2,
      ...(failedAt ? { failedAt } : {}),
    },
  });
}

function healthCtx() {
  return {
    request: new Request("http://localhost/api/health", { method: "GET" }),
    params: {},
    url: new URL("http://localhost/api/health"),
  } as any;
}

beforeEach(async () => {
  sendPushToEvent.mockClear();
  sendPushToEvent.mockRejectedValue(new Error("fcm down"));
  await prisma.notificationJob.deleteMany({ where: { eventId: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.scheduledJob.deleteMany();
  await prisma.schedulerHeartbeat.deleteMany();
  await prisma.$executeRawUnsafe(
    "UPDATE _prisma_migrations SET started_at = ?",
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  );
  process.env.BACKUPS_ENABLED_NORMALIZED = "true";
  process.env.BACKUPS_ACTIVE = "true";
});

describe("notification dead-letter visibility (#1775)", () => {
  it("returns delivered and dead-lettered counts separately", async () => {
    await seedEvent();
    await seedExhaustedJob();

    const result = await drainNotificationQueue();

    // Attempted 1, delivered 0, dead-lettered 1 — drained can no longer equal
    // attempted, which is what hid a fully dead-lettered batch.
    expect(result).toEqual({ delivered: 0, deadLettered: 1 });

    const job = await prisma.notificationJob.findFirst({ where: { eventId: EVENT_ID } });
    expect(job?.failedAt).not.toBeNull();
  });

  it("reports 24h NotificationJob dead-letters beside scheduler.failedJobs", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await seedEvent();
      const failedAt = new Date();
      await seedExhaustedJob(failedAt);
      await prisma.schedulerHeartbeat.upsert({
        where: { id: "scheduler" },
        create: { id: "scheduler", lastSeenAt: new Date() },
        update: { lastSeenAt: new Date() },
      });

      const res = await health(healthCtx());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.scheduler.failedJobs).toBe(0);
      expect(body.scheduler.notificationDeadLetters).toBe(1);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
    }
  });

  it("lists notification dead-letters with type, event and failedAt in admin", async () => {
    await seedEvent();
    const failedAt = new Date();
    const job = await seedExhaustedJob(failedAt);

    const stats = await getAdminStats();

    const row = stats.jobFailures.find((f) => f.id === job.id);
    expect(row).toBeDefined();
    expect(row?.type).toBe("player_joined");
    expect(row?.eventId).toBe(EVENT_ID);
    expect(row?.failedAt?.getTime()).toBe(failedAt.getTime());
    expect(row?.deadLettered).toBe(true);
    expect(row?.source).toBe("notification");
  });
});
