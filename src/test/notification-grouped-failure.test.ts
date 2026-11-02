/**
 * GH-1592 — a collapsed (grouped) player-activity send that throws must spend
 * the same retry budget as the single-job path, and the loss must be visible.
 *
 * `claimBatchOrNull` stamps `processedAt` on up to BATCH_SIZE rows before any
 * push is attempted. The grouped catch only logged, so the rows kept
 * `processedAt`, `failedAt` stayed null — no retry, no dead-letter, no counter —
 * while the non-grouped path reset the claim and retried three times. One
 * transport error dropped a whole drain's joins (and the payer notice, which
 * rides the same grouped path).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { drainNotificationQueue } from "~/lib/notificationQueue.server";
import { countFailedJobs } from "~/lib/scheduler.server";

vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: vi.fn(),
}));

import { sendPushToEvent } from "~/lib/push.server";

const EVENT_ID = "evt-1592";

function joinPayload(name: string): string {
  return JSON.stringify({
    title: "Event",
    key: "notifyPlayerJoined",
    params: { name },
    url: "/e/1592",
    spotsLeft: 3,
  });
}

/** `count` player_joined jobs for one event — 2+ collapse into one send. */
async function seedCollapsedJoins(count: number, retryCount = 0): Promise<void> {
  await prisma.event.create({
    data: { id: EVENT_ID, title: "Grouped", location: "Pitch", dateTime: new Date(Date.now() + 86_400_000) },
  });
  for (let i = 0; i < count; i++) {
    await prisma.notificationJob.create({
      data: { type: "player_joined", eventId: EVENT_ID, payload: joinPayload(`P${i}`), retryCount },
    });
  }
}

function groupedRows() {
  return prisma.notificationJob.findMany({ where: { eventId: EVENT_ID }, orderBy: { id: "asc" } });
}

beforeEach(async () => {
  await prisma.notificationJob.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.scheduledJob.deleteMany();
  await prisma.event.deleteMany();
  vi.mocked(sendPushToEvent).mockReset();
});

describe("drainNotificationQueue — grouped send failure (#1592)", () => {
  it("rejects one collapsed send for a 3-join batch and leaves every row pending with retryCount 1", async () => {
    await seedCollapsedJoins(3);
    vi.mocked(sendPushToEvent).mockRejectedValue(new Error("fcm unavailable"));

    await expect(drainNotificationQueue()).resolves.toBe(3);

    // One collapsed send for the event, not one per join.
    expect(sendPushToEvent).toHaveBeenCalledTimes(1);

    const rows = await groupedRows();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.processedAt).toBeNull(); // claim released → the next drain retries
      expect(row.retryCount).toBe(1);
      expect(row.failedAt).toBeNull();
    }
  });

  it("retries the collapsed group on the next drain once the send recovers", async () => {
    await seedCollapsedJoins(3);
    vi.mocked(sendPushToEvent).mockRejectedValueOnce(new Error("fcm unavailable"));
    await drainNotificationQueue();

    vi.mocked(sendPushToEvent).mockResolvedValue(undefined);
    await expect(drainNotificationQueue()).resolves.toBe(3);

    const rows = await groupedRows();
    for (const row of rows) {
      expect(row.processedAt).not.toBeNull();
      expect(row.retryCount).toBe(1); // the failed attempt stays spent
      expect(row.failedAt).toBeNull();
    }
    expect(sendPushToEvent).toHaveBeenCalledTimes(2);
  });

  it("dead-letters the rows after MAX_RETRIES and stops claiming them", async () => {
    await seedCollapsedJoins(3, 2); // one attempt left before the cap
    vi.mocked(sendPushToEvent).mockRejectedValue(new Error("fcm unavailable"));

    await expect(drainNotificationQueue()).resolves.toBe(3);

    const rows = await groupedRows();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.failedAt).not.toBeNull();
      expect(row.processedAt).toBeNull();
      expect(row.retryCount).toBe(2); // capped, not incremented past MAX_RETRIES
    }

    // Dead letters are excluded from the claim: no further send is attempted.
    vi.mocked(sendPushToEvent).mockReset();
    vi.mocked(sendPushToEvent).mockResolvedValue(undefined);
    await expect(drainNotificationQueue()).resolves.toBe(0);
    expect(sendPushToEvent).not.toHaveBeenCalled();
  });
});

describe("failure visibility (#1592)", () => {
  it("counts a dead-lettered NotificationJob in the health window beside ScheduledJobs", async () => {
    await prisma.event.create({
      data: { id: EVENT_ID, title: "Grouped", location: "Pitch", dateTime: new Date(Date.now() + 86_400_000) },
    });
    await prisma.notificationJob.create({
      data: {
        type: "player_joined",
        eventId: EVENT_ID,
        payload: joinPayload("Ana"),
        failedAt: new Date(),
        retryCount: 2,
      },
    });
    await prisma.scheduledJob.create({
      data: { type: "reminder_24h", runAt: new Date(), failedAt: new Date(), lastError: "boom" },
    });

    expect(await countFailedJobs()).toBe(2);
  });

  it("lists a dead-lettered NotificationJob next to ScheduledJob failures on the admin surface", async () => {
    await prisma.event.create({
      data: { id: EVENT_ID, title: "Grouped", location: "Pitch", dateTime: new Date(Date.now() + 86_400_000) },
    });
    const dead = await prisma.notificationJob.create({
      data: {
        type: "player_joined",
        eventId: EVENT_ID,
        payload: joinPayload("Ana"),
        failedAt: new Date(),
        retryCount: 2,
      },
    });
    const retrying = await prisma.notificationJob.create({
      data: {
        type: "payer_assigned",
        eventId: EVENT_ID,
        payload: joinPayload("Bo"),
        retryCount: 1,
        processedAt: null,
      },
    });
    // Failed once, then delivered on retry: a delivered job is not a failure.
    const recovered = await prisma.notificationJob.create({
      data: {
        type: "player_left",
        eventId: EVENT_ID,
        payload: joinPayload("Cy"),
        retryCount: 1,
        processedAt: new Date(),
      },
    });
    const scheduled = await prisma.scheduledJob.create({
      data: { type: "reminder_24h", runAt: new Date(), failedAt: new Date(), lastError: "boom" },
    });

    const { getAdminStats } = await import("~/lib/admin.server");
    const stats = await getAdminStats();

    const ids = stats.jobFailures.map((f) => f.id);
    expect(ids).toContain(dead.id);
    expect(ids).toContain(retrying.id);
    expect(ids).toContain(scheduled.id);
    expect(ids).not.toContain(recovered.id);

    const deadRow = stats.jobFailures.find((f) => f.id === dead.id)!;
    expect(deadRow.type).toBe("player_joined");
    expect(deadRow.deadLettered).toBe(true);
    // NotificationJob has no lastError column: the row records the failure
    // state, not the transport text.
    expect(deadRow.lastError).toBeNull();

    const retryingRow = stats.jobFailures.find((f) => f.id === retrying.id)!;
    expect(retryingRow.deadLettered).toBe(false);
    expect(retryingRow.retryCount).toBe(1);

    // Dead-letters sort ahead of retrying rows across both tables.
    expect(stats.jobFailures.at(-1)!.deadLettered).toBe(false);
    expect(stats.jobFailures.filter((f) => f.deadLettered)).toHaveLength(2);
  });
});
