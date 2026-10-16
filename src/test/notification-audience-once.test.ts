/**
 * GH-1403 — the notification audience resolves once per job, and both channels
 * consume the same recipient list.
 *
 * Seam under test: the drain's public interface — `enqueueNotification` then
 * `drainNotificationQueue` — observed at each channel's own interface: web push
 * through the web-push transport, mobile push through the FCM transport, and
 * the in-app feed through the `InAppNotification` rows the drain writes.
 *
 * The recipient-set tests below are the INVARIANT: they pin who receives what,
 * today and after the refactor. Without them "fewer queries" and "same
 * behaviour" are indistinguishable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "crypto";
import { prisma } from "~/lib/db.server";

// ── Transports only — the audience rule under test is untouched. ──────────────
const mockSendNotification = vi.fn().mockResolvedValue({});
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mockSendNotification },
  setVapidDetails: vi.fn(),
  sendNotification: mockSendNotification,
}));

/** Exact host of a URL, so no assertion matches a substring of a host. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const mockFetch = vi.fn().mockImplementation(async (url: string) => {
  if (hostOf(url) === "oauth2.googleapis.com") {
    return { ok: true, json: async () => ({ access_token: "mock-fcm-token", expires_in: 3600 }) };
  }
  if (hostOf(url) === "fcm.googleapis.com") {
    return { ok: true, json: async () => ({ name: "projects/test/messages/1" }) };
  }
  return { ok: true, json: async () => ({}) };
});
vi.stubGlobal("fetch", mockFetch);

// FCM signs a real JWT, so it needs a real key.
const { privateKey: testPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: "test-project",
  client_email: "test@test.iam.gserviceaccount.dev",
  private_key: testPrivateKey.export({ type: "pkcs8", format: "pem" }),
});

import {
  drainNotificationQueue,
  enqueueNotification,
  type NotificationJobPayload,
  type NotificationJobType,
} from "~/lib/notificationQueue.server";

const EVENT_ID = "evt-1403";

const payload: NotificationJobPayload = {
  title: "Event",
  key: "notifyPlayerJoined",
  params: { name: "Ana" },
  url: "/e/1403",
  spotsLeft: 3,
};

/**
 * The representative audience: a muted Follower, a Player, a Follower who
 * turned push off, a Tier 2 non-Player, and a plain Follower-Player. Every
 * recipient carries a web subscription and an app token, so each channel's
 * recipient set is observable.
 */
async function seedAudience() {
  const followers = [
    { id: "p-player", mute: {} },
    { id: "f-muted", mute: { mutePlayerActivity: true, muteEventDetails: true } },
    { id: "f-pushoff", mute: {} },
    { id: "f-tier2", mute: {} },
    { id: "f-open", mute: {} },
  ] as const;

  for (const f of followers) {
    await prisma.user.create({ data: { id: f.id, name: f.id, email: `${f.id}@test.com`, emailVerified: true } });
    await prisma.eventFollow.create({ data: { eventId: EVENT_ID, userId: f.id, ...f.mute } });
    await prisma.pushSubscription.create({
      data: { userId: f.id, endpoint: `https://${f.id}.endpoint`, p256dh: "p", auth: "a" },
    });
    await prisma.appPushToken.create({
      data: { userId: f.id, token: `fcm-${f.id}`, platform: "android" },
    });
  }

  // Players in the Event: everyone except the Tier 2 watcher.
  for (const id of ["p-player", "f-pushoff", "f-open"]) {
    await prisma.player.create({ data: { eventId: EVENT_ID, name: id, userId: id } });
  }

  // Push off is a transport preference (ADR 0017 role tier is untouched).
  await prisma.notificationPreferences.create({
    data: { userId: "f-pushoff", pushEnabled: false },
  });
}

/** User ids the web-push channel actually delivered to. */
function webPushUsers(): string[] {
  return mockSendNotification.mock.calls
    .map((c) => (c[0] as { endpoint: string }).endpoint.replace(/^https:\/\/(.*)\.endpoint$/, "$1"))
    .sort();
}

/** User ids the FCM channel actually delivered to (AppPushToken.token is `fcm-<id>`). */
function fcmUsers(): string[] {
  return mockFetch.mock.calls
    .filter((c: unknown[]) => typeof c[0] === "string" && hostOf(c[0] as string) === "fcm.googleapis.com")
    .map((c) => {
      const body = JSON.parse((c[1] as { body: string }).body) as { message?: { token?: string } };
      return (body.message?.token ?? "").replace(/^fcm-/, "");
    })
    .sort();
}

/** User ids the in-app feed wrote a row for. */
async function feedUsers(): Promise<string[]> {
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
  mockFetch.mockClear();

  await prisma.notificationJob.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.appPushToken.deleteMany();
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
  vi.restoreAllMocks();
  if (prevPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
  else process.env.VAPID_PUBLIC_KEY = prevPublic;
  if (prevPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = prevPrivate;
});

async function drainJob(type: NotificationJobType, body: Partial<NotificationJobPayload> = {}) {
  await enqueueNotification(EVENT_ID, type, { ...payload, ...body });
  await drainNotificationQueue();
}

describe("GH-1403 — invariant: a drained job reaches the same people on every channel", () => {
  it("delivers a Tier 2 job to Players on both transports and keeps the rest in the feed only", async () => {
    await seedAudience();

    await drainJob("player_joined");

    // The muted Follower and the Tier 2 non-Player are vetoed by ADR 0004/0017
    // on every channel. The push-off Follower is vetoed on the transports only —
    // their feed row is how they read back a notification they were not sent.
    expect(webPushUsers()).toEqual(["f-open", "p-player"]);
    expect(fcmUsers()).toEqual(["f-open", "p-player"]);
    expect(await feedUsers()).toEqual(["f-open", "f-pushoff", "p-player"]);
  });

  it("delivers a Tier 1 job to everyone the mute overrides do not veto", async () => {
    await seedAudience();

    await drainJob("event_details", {
      key: "notifyEventDetailsChanged",
      params: { title: "Event" },
    });

    // Tier 1 has no role gate, so the non-Player Follower is in on both
    // transports; only the muted and the push-off Follower stay out of push.
    expect(webPushUsers()).toEqual(["f-open", "f-tier2", "p-player"]);
    expect(fcmUsers()).toEqual(["f-open", "f-tier2", "p-player"]);
    expect(await feedUsers()).toEqual(["f-open", "f-pushoff", "f-tier2", "p-player"]);
  });

  it("withholds a ping from an invite-opted-out Follower on every channel", async () => {
    // One audience per job means the FCM transport reads the same ping
    // suppression the web transport and the feed already read. Before this the
    // FCM helper resolved the audience on its own and lost it.
    await seedAudience();
    await prisma.eventPlayer.create({
      data: { eventId: EVENT_ID, name: "f-tier2", userId: "f-tier2", invitationOptOutAt: new Date() },
    });

    await drainJob("recruitment", { key: "notifyRecruitment", params: { title: "Event" } });

    expect(webPushUsers()).toEqual(["f-open", "p-player"]);
    expect(fcmUsers()).toEqual(["f-open", "p-player"]);
    expect(await feedUsers()).toEqual(["f-open", "f-pushoff", "p-player"]);
  });
});

describe("GH-1403 — the audience is resolved once per drained job", () => {
  it("loads the Follows and the preferences once, not once per channel", async () => {
    await seedAudience();
    const follows = vi.spyOn(prisma.eventFollow, "findMany");
    const prefs = vi.spyOn(prisma.notificationPreferences, "findMany");

    await drainJob("player_joined");

    expect(follows).toHaveBeenCalledTimes(1);
    expect(prefs).toHaveBeenCalledTimes(1);
  });
});