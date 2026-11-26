/**
 * GH-1735 — a notification claimed by a worker that dies before delivery must
 * be rediscovered, not silently lost.
 *
 * The outbox used to stamp `processedAt` inside the claim transaction, before
 * any send ran, and the drain only looked for `processedAt: null`. A restart
 * between claim and send therefore removed up to BATCH_SIZE notifications from
 * every later pass. The test simulates that exact death: the claim transaction
 * commits, then the process "dies" before `sendPushToEvent` is called.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const sendPushToEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: (...args: unknown[]) => sendPushToEvent(...args),
}));

import { drainNotificationQueue } from "~/lib/notificationQueue.server";

const EVENT_ID = "evt-1735";
const USER_ID = "user-1735";
const JOB_ID = "job-1735";

/** Comfortably beyond the queue's claim lease (5 minutes). */
const LEASE_ADVANCE_MS = 11 * 60 * 1000;

async function seedClaimedJob() {
  await prisma.user.create({
    data: { id: USER_ID, name: "Claim User", email: `${USER_ID}@test.com`, emailVerified: true },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Reclaim",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
    },
  });
  await prisma.notificationJob.create({
    data: {
      id: JOB_ID,
      eventId: EVENT_ID,
      type: "event_details",
      payload: JSON.stringify({
        title: "Reclaim",
        key: "notifyEventDetailsChanged",
        params: { title: "Reclaim" },
        url: `/events/${EVENT_ID}`,
        spotsLeft: 3,
        recipientUserIds: [USER_ID],
      }),
    },
  });
}

beforeEach(async () => {
  sendPushToEvent.mockClear();
  sendPushToEvent.mockResolvedValue(undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));

  await prisma.notificationJob.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("notification claim lease (#1735)", () => {
  it("redelivers a job whose worker died between claim and send", async () => {
    await seedClaimedJob();

    // The claim commits, then the process dies before the send: exactly the
    // window the Issue describes.
    const realTransaction = prisma.$transaction.bind(prisma);
    const txSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (
      ...args: unknown[]
    ) => {
      await (realTransaction as (...a: unknown[]) => Promise<unknown>)(...args);
      throw new Error("simulated process death after the claim committed");
    }) as never);

    await expect(drainNotificationQueue()).rejects.toThrow("simulated process death");
    expect(sendPushToEvent).not.toHaveBeenCalled();
    txSpy.mockRestore();

    const stalled = await prisma.notificationJob.findUniqueOrThrow({ where: { id: JOB_ID } });
    expect(stalled.failedAt).toBeNull();

    // The dead worker's claim is still inside its lease: no duplicate send.
    await expect(drainNotificationQueue()).resolves.toBe(0);
    expect(sendPushToEvent).not.toHaveBeenCalled();

    // Once the lease lapses, the next pass reclaims and delivers it.
    vi.setSystemTime(new Date(Date.now() + LEASE_ADVANCE_MS));
    await expect(drainNotificationQueue()).resolves.toBe(1);
    expect(sendPushToEvent).toHaveBeenCalledTimes(1);

    const delivered = await prisma.notificationJob.findUniqueOrThrow({ where: { id: JOB_ID } });
    expect(delivered.processedAt).not.toBeNull();
    expect(delivered.failedAt).toBeNull();
  });
});
