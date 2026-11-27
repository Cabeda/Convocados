/**
 * #1736 — a stalled push channel must not hold the join response open.
 *
 * The route commits the roster row before the push fan-out starts. If the send
 * hangs, the Android client abandons the join at 15s and shows a network error
 * for a join that already succeeded. The drain therefore has to run after the
 * response, not before it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const drainState = vi.hoisted(() => {
  const pending = new Promise<number>(() => {});
  return { drain: vi.fn(() => pending) };
});

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: drainState.drain,
  scheduleNotificationDrain: vi.fn(() => {
    void drainState.drain();
  }),
  deliverInviteNotification: vi.fn().mockResolvedValue({ email: false, webPush: false, appPush: false }),
}));

import { POST as rosterPost } from "~/pages/api/events/[id]/players";

function request(body: Record<string, unknown>) {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("host", "convocados.test");
  return new Request("http://convocados.test/api/events/evt-drain/players", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("route waited for the notification drain")), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  drainState.drain.mockClear();
  await prisma.notificationJob.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("join route vs notification drain (#1736)", () => {
  it("returns before a stalled drain settles", async () => {
    const event = await prisma.event.create({
      data: {
        id: "evt-drain",
        title: "Drain Test",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86_400_000),
        maxPlayers: 5,
      },
    });
    const previousVitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const response = await withDeadline(
        rosterPost({
          params: { id: event.id },
          request: request({ name: "Fast Join" }),
        } as never),
        3_000,
      );

      expect(response!.status).toBe(200);
      expect(drainState.drain).toHaveBeenCalled();
    } finally {
      if (previousVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
    }
  });
});
