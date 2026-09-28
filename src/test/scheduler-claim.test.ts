/**
 * Job runner semantics (scheduler deepening, PR 1/5):
 * - atomic claim before side effects (SQLite CAS via guarded updateMany)
 * - exponential backoff on failure (runAt pushed forward, claim released)
 * - stale-lease redelivery (crashed worker's claim expires)
 * - bounded fetch (take limit) and queryable dead letters
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  getDueJobs,
  processJob,
  claimJob,
  countFailedJobs,
  CLAIM_LEASE_MS,
} from "~/lib/scheduler.server";
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

async function seedUser(id = "user-claim-1") {
  return prisma.user.create({
    data: { id, name: "Claim User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(ownerId: string, dateTime: Date, id = "evt-claim-1") {
  return prisma.event.create({
    data: { id, title: "Claim Game", location: "Field", dateTime, maxPlayers: 10, ownerId, durationMinutes: 60 },
  });
}

/** Create one reminder_24h job fast-forwarded to "due now". */
async function seedDueReminderJob(eventId: string, id?: string) {
  return prisma.scheduledJob.create({
    data: {
      ...(id ? { id } : {}),
      eventId,
      type: "reminder_24h",
      runAt: new Date(Date.now() - 1000),
      payload: "{}",
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

describe("claimJob", () => {
  it("only one caller wins the claim", async () => {
    const user = await seedUser();
    const event = await seedEvent(user.id, new Date(Date.now() + 25 * 3600_000));
    const job = await seedDueReminderJob(event.id);

    const first = await claimJob(job.id);
    const second = await claimJob(job.id);

    expect(first).not.toBeNull();
    expect(first!.claimedBy).toBeTruthy();
    expect(second).toBeNull();
  });

  it("a claim held longer than the lease expires and becomes claimable again", async () => {
    const user = await seedUser("user-stale");
    const event = await seedEvent(user.id, new Date(Date.now() + 25 * 3600_000), "evt-stale");
    const job = await seedDueReminderJob(event.id);

    // Simulate a worker that claimed then crashed: lease is stale.
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { claimedAt: new Date(Date.now() - CLAIM_LEASE_MS - 1000), claimedBy: "dead-worker" },
    });

    const due = await getDueJobs();
    expect(due.map((j) => j.id)).toContain(job.id);

    const reclaimed = await claimJob(job.id);
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.claimedBy).not.toBe("dead-worker");
  });

  it("an active lease is not stolen", async () => {
    const user = await seedUser("user-lease");
    const event = await seedEvent(user.id, new Date(Date.now() + 25 * 3600_000), "evt-lease");
    const job = await seedDueReminderJob(event.id);
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { claimedAt: new Date(), claimedBy: "worker-a" },
    });

    expect(await claimJob(job.id)).toBeNull();
    // Active claim also hides the job from the due fetch.
    const due = await getDueJobs();
    expect(due.map((j) => j.id)).not.toContain(job.id);
  });
});

describe("processJob — claim-before-side-effects", () => {
  it("concurrent calls execute the side effect exactly once", async () => {
    const user = await seedUser("user-conc");
    const event = await seedEvent(user.id, new Date(Date.now() + 25 * 3600_000), "evt-conc");
    await prisma.player.create({ data: { name: "P1", eventId: event.id, userId: user.id } });
    const job = await seedDueReminderJob(event.id);

    const [a, b] = await Promise.all([processJob(job.id), processJob(job.id)]);

    expect([a, b].sort()).toEqual(["processed", "skipped"]);
    expect(vi.mocked(notificationQueue.enqueueNotification)).toHaveBeenCalledTimes(1);

    const updated = await prisma.scheduledJob.findUnique({ where: { id: job.id } });
    expect(updated!.processedAt).not.toBeNull();
    expect(updated!.retryCount).toBe(0);
    expect(updated!.claimedAt).toBeNull();
  });

  it("returns skipped for already processed jobs", async () => {
    const user = await seedUser("user-skip");
    const event = await seedEvent(user.id, new Date(Date.now() + 25 * 3600_000), "evt-skip");
    const job = await prisma.scheduledJob.create({
      data: { eventId: event.id, type: "reminder_24h", runAt: new Date(), processedAt: new Date() },
    });

    expect(await processJob(job.id)).toBe("skipped");
    expect(vi.mocked(notificationQueue.enqueueNotification)).not.toHaveBeenCalled();
  });
});

describe("processJob — backoff", () => {
  it("failure pushes runAt into the future and releases the claim", async () => {
    const user = await seedUser("user-backoff");
    const event = await seedEvent(user.id, new Date(Date.now() + 25 * 3600_000), "evt-backoff");
    await prisma.player.create({ data: { name: "P1", eventId: event.id, userId: user.id } });
    const job = await seedDueReminderJob(event.id);

    vi.mocked(notificationQueue.enqueueNotification).mockRejectedValueOnce(new Error("boom"));
    await expect(processJob(job.id)).rejects.toThrow("boom");

    const updated = await prisma.scheduledJob.findUnique({ where: { id: job.id } });
    expect(updated!.retryCount).toBe(1);
    expect(updated!.failedAt).toBeNull();
    expect(updated!.claimedAt).toBeNull(); // claim released for the retry
    expect(updated!.runAt.getTime()).toBeGreaterThan(Date.now() + 5_000); // backoff, not immediate re-fetch

    // Not due again until the backoff elapses — worker polls find nothing.
    expect(await getDueJobs()).toHaveLength(0);
  });

  it("exhausted retries dead-letter the job and report it", async () => {
    const user = await seedUser("user-dead");
    const event = await seedEvent(user.id, new Date(Date.now() + 25 * 3600_000), "evt-dead");
    await prisma.player.create({ data: { name: "P1", eventId: event.id, userId: user.id } });
    const job = await seedDueReminderJob(event.id);
    await prisma.scheduledJob.update({ where: { id: job.id }, data: { retryCount: 2 } });

    vi.mocked(notificationQueue.enqueueNotification).mockRejectedValueOnce(new Error("boom"));
    await expect(processJob(job.id)).rejects.toThrow("boom");

    const updated = await prisma.scheduledJob.findUnique({ where: { id: job.id } });
    expect(updated!.failedAt).not.toBeNull();
    expect(updated!.claimedAt).toBeNull();
    expect(await getDueJobs()).toHaveLength(0);
    expect(await countFailedJobs()).toBe(1);
  });
});

describe("getDueJobs — bounded fetch", () => {
  it("respects the limit", async () => {
    const user = await seedUser("user-limit");
    const event = await seedEvent(user.id, new Date(Date.now() + 25 * 3600_000), "evt-limit");
    for (let i = 0; i < 5; i++) await seedDueReminderJob(event.id);

    const due = await getDueJobs(2);
    expect(due).toHaveLength(2);
    // Default limit is generous: all 5 come back without an argument.
    expect(await getDueJobs()).toHaveLength(5);
  });
});
