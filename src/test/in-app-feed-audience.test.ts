/**
 * GH-1396 — a muted Follower gets no in-app notification.
 *
 * Push delivery filters its audience through the mute + role-tier check
 * (ADR 0017). The in-app feed must reach the *same* audience. These tests
 * drive the real drain and observe both channels at their own interfaces:
 * web push through the web-push transport, the feed through the
 * InAppNotification rows the drain writes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

// Transport adapter only — the audience rule under test is untouched.
const mockSendNotification = vi.fn().mockResolvedValue({});
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mockSendNotification },
  setVapidDetails: vi.fn(),
  sendNotification: mockSendNotification,
}));

import {
  drainNotificationQueue,
  enqueueNotification,
  type NotificationJobPayload,
  type NotificationJobType,
} from "~/lib/notificationQueue.server";

const EVENT_ID = "evt-1396";

const payload = {
  title: "Event",
  key: "notifyPlayerJoined" as const,
  params: { name: "Ana" },
  url: "/e/1396",
  spotsLeft: 3,
};

async function seedFollower(id: string, follow: Record<string, unknown> = {}) {
  await prisma.user.create({ data: { id, name: id, email: `${id}@test.com`, emailVerified: true } });
  await prisma.eventFollow.create({ data: { eventId: EVENT_ID, userId: id, ...follow } });
  await prisma.pushSubscription.create({
    data: { userId: id, endpoint: `https://${id}.endpoint`, p256dh: "p", auth: "a" },
  });
  return id;
}

async function seedPlayer(userId: string) {
  await prisma.player.create({ data: { eventId: EVENT_ID, name: userId, userId } });
}

/** Endpoints the push channel actually delivered to. */
function pushedEndpoints(): string[] {
  return mockSendNotification.mock.calls
    .map((c) => (c[0] as { endpoint: string }).endpoint)
    .sort();
}

/** User ids the in-app feed wrote a row for. */
async function feedUserIds(): Promise<string[]> {
  const rows = await prisma.inAppNotification.findMany({ where: { eventId: EVENT_ID } });
  return rows.map((r) => r.userId).sort();
}

let prevPublic: string | undefined;
let prevPrivate: string | undefined;

beforeEach(async () => {
  prevPublic = process.env.VAPID_PUBLIC_KEY;
  prevPrivate = process.env.VAPID_PRIVATE_KEY;
  process.env.VAPID_PUBLIC_KEY = "test-public";
  process.env.VAPID_PRIVATE_KEY = "test-private";
  mockSendNotification.mockClear();

  await prisma.notificationJob.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.event.create({
    data: { id: EVENT_ID, title: "Event", location: "Pitch", dateTime: new Date() },
  });
});

afterEach(() => {
  if (prevPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
  else process.env.VAPID_PUBLIC_KEY = prevPublic;
  if (prevPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = prevPrivate;
});

async function drainJob(type: NotificationJobType, body: Partial<NotificationJobPayload> = {}) {
  await enqueueNotification(EVENT_ID, type, { ...payload, ...body });
  await drainNotificationQueue();
}

describe("notification audience — push and in-app feed agree", () => {
  it("gives a Follower who muted the channel neither push nor a feed row", async () => {
    await seedFollower("f-muted", { mutePlayerActivity: true });
    await seedFollower("f-live");
    await seedPlayer("f-live");

    await drainJob("player_joined");

    expect(pushedEndpoints()).toEqual(["https://f-live.endpoint"]);
    expect(await feedUserIds()).toEqual(["f-live"]);
  });

  it("withholds a Tier 2 type from a non-Player Follower on both channels (ADR 0017)", async () => {
    await seedFollower("f-player");
    await seedPlayer("f-player");
    await seedFollower("f-watcher");

    await drainJob("player_joined");

    expect(pushedEndpoints()).toEqual(["https://f-player.endpoint"]);
    expect(await feedUserIds()).toEqual(["f-player"]);
  });

  it("still delivers a Tier 1 type to a non-Player Follower on both channels", async () => {
    await seedFollower("f-watcher");
    await seedFollower("f-muted", { muteEventDetails: true });

    await drainJob("event_details", {
      key: "notifyEventDetailsChanged" as const,
      params: { title: "Event" },
    });

    expect(pushedEndpoints()).toEqual(["https://f-watcher.endpoint"]);
    expect(await feedUserIds()).toEqual(["f-watcher"]);
  });
});