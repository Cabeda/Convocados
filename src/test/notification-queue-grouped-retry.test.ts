import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const sendPushToEvent = vi.fn().mockRejectedValue(new Error("fcm down"));
vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: (...args: unknown[]) => sendPushToEvent(...args),
}));

import { drainNotificationQueue } from "~/lib/notificationQueue.server";

const EVENT_ID = "grouped-retry-event";

async function seedJoinedJobs() {
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Grouped Retry",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
    },
  });
  for (const name of ["Ana", "Bob"]) {
    await prisma.notificationJob.create({
      data: {
        eventId: EVENT_ID,
        type: "player_joined",
        payload: JSON.stringify({
          title: "Grouped Retry",
          key: "notifyPlayerJoined",
          params: { name },
          url: `/events/${EVENT_ID}`,
          spotsLeft: 3,
        }),
      },
    });
  }
}

beforeEach(async () => {
  sendPushToEvent.mockClear();
  sendPushToEvent.mockRejectedValue(new Error("fcm down"));
  await prisma.notificationJob.deleteMany({ where: { eventId: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
});

describe("grouped notification retry", () => {
  it("resets the whole collapsed batch and retries until dead-letter", async () => {
    await seedJoinedJobs();

    await expect(drainNotificationQueue()).resolves.toBe(2);

    const afterFirst = await prisma.notificationJob.findMany({ where: { eventId: EVENT_ID } });
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst.every((job) => job.retryCount === 1)).toBe(true);
    expect(afterFirst.every((job) => job.processedAt === null)).toBe(true);
    expect(afterFirst.every((job) => job.failedAt === null)).toBe(true);

    await drainNotificationQueue();
    await drainNotificationQueue();

    const dead = await prisma.notificationJob.findMany({ where: { eventId: EVENT_ID } });
    expect(dead.every((job) => job.failedAt !== null)).toBe(true);
    expect(dead.every((job) => job.processedAt === null)).toBe(true);
  });
});
