/**
 * GH-1346 — a contended drain must not fail the job that triggered it.
 *
 * The claim transaction runs under SQLite's busy timeout (5s). When another
 * writer held the lock longer, the claim threw, the throw propagated into
 * whichever job called `drainNotificationQueue()` (a reminder, a roster
 * change), and that job's retry budget was spent on a timing collision. Three
 * reminders dead-lettered together this way on 2026-06-11.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { drainNotificationQueue } from "~/lib/notificationQueue.server";

const EVENT_ID = "evt-1346";

beforeEach(async () => {
  await prisma.notificationJob.deleteMany();
  await prisma.inAppNotification.deleteMany();
  vi.restoreAllMocks();
});

describe("drainNotificationQueue under a busy database (#1346)", () => {
  it("returns instead of throwing, and leaves the job pending for the next drain", async () => {
    // Written directly: `enqueueNotification` schedules a drain, and the point
    // here is the drain that finds this row.
    await prisma.event.create({
      data: { id: EVENT_ID, title: "Busy", location: "Pitch", dateTime: new Date(Date.now() + 86400_000) },
    });
    await prisma.notificationJob.create({
      data: {
        type: "player_joined",
        eventId: EVENT_ID,
        payload: JSON.stringify({
          title: "Event",
          key: "notifyPlayerJoined",
          params: { name: "Ana" },
          url: "/e/1346",
          spotsLeft: 3,
        }),
      },
    });

    // What better-sqlite3 reports when the busy timeout expires.
    const busy = new Error("SQLITE_BUSY: database is locked");
    const txSpy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(busy);

    await expect(drainNotificationQueue()).resolves.toBe(0);
    expect(txSpy).toHaveBeenCalled();

    // Nothing was claimed, so nothing was lost.
    const pending = await prisma.notificationJob.findMany({ where: { eventId: EVENT_ID } });
    expect(pending).toHaveLength(1);
    expect(pending[0].processedAt).toBeNull();
    expect(pending[0].failedAt).toBeNull();

    // The next drain takes it — the retry is the next call, not a dead letter.
    txSpy.mockRestore();
    await expect(drainNotificationQueue()).resolves.toBe(1);
    const after = await prisma.notificationJob.findMany({ where: { eventId: EVENT_ID } });
    expect(after[0].processedAt).not.toBeNull();
  });

  it("still propagates an error that is not a lock timeout", async () => {
    const boom = new Error("relation does not exist");
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(boom);

    await expect(drainNotificationQueue()).rejects.toThrow("relation does not exist");
  });
});
