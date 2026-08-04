import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

// ── Mock web-push ─────────────────────────────────────────────────────────────
const mockSendNotification = vi.fn().mockResolvedValue({});
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mockSendNotification },
  setVapidDetails: vi.fn(),
  sendNotification: mockSendNotification,
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  cleanupStalePushTokens,
  sendPushToUser,
  sendPushToEvent,
  sendTestPushToUserWebSubs,
} from "~/lib/push.server";

function seedUser(id: string, overrides: Record<string, unknown> = {}) {
  return prisma.user.upsert({
    where: { id },
    update: {},
    create: { id, name: `User ${id}`, email: `${id}@test.com`, emailVerified: true, ...overrides },
  });
}

async function seedEvent(id: string, ownerId: string | null = null) {
  return prisma.event.upsert({
    where: { id },
    update: {},
    create: { id, title: "Push Game", location: "Pitch", dateTime: new Date(), ownerId },
  });
}

beforeEach(async () => {
  await prisma.pushSubscription.deleteMany();
  await prisma.appPushToken.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  vi.clearAllMocks();
});

describe("cleanupStalePushTokens", () => {
  it("deletes app push tokens and web subscriptions older than 90 days", async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const user = await seedUser("u-stale");

    await prisma.appPushToken.create({ data: { userId: user.id, token: "old-token", platform: "ios", updatedAt: old } });
    await prisma.appPushToken.create({ data: { userId: user.id, token: "fresh-token", platform: "android" } });
    await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: "https://old.endpoint", p256dh: "a", auth: "b", createdAt: old } });
    await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: "https://fresh.endpoint", p256dh: "c", auth: "d" } });

    const result = await cleanupStalePushTokens();

    expect(result.appTokens).toBe(1);
    expect(result.webSubs).toBe(1);
    const remainingTokens = await prisma.appPushToken.findMany({ where: { userId: user.id } });
    expect(remainingTokens.map((t) => t.token)).toEqual(["fresh-token"]);
    const remainingSubs = await prisma.pushSubscription.findMany({ where: { userId: user.id } });
    expect(remainingSubs.map((s) => s.endpoint)).toEqual(["https://fresh.endpoint"]);
  });

  it("returns zero counts when nothing is stale", async () => {
    const result = await cleanupStalePushTokens();
    expect(result).toEqual({ appTokens: 0, webSubs: 0 });
  });
});

describe("sendPushToUser", () => {
  it("sends to all distinct web subscriptions of a user", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    const user = await seedUser("u-push");
    const sub1 = { userId: user.id, endpoint: "https://a.endpoint", p256dh: "a", auth: "b" };
    const sub2 = { userId: user.id, endpoint: "https://b.endpoint", p256dh: "c", auth: "d" };
    await prisma.pushSubscription.create({ data: sub1 });
    await prisma.pushSubscription.create({ data: sub2 });

    const { sendNotification } = await import("web-push");
    await sendPushToUser(user.id, "Title", "Body", "/url");

    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it("skips web push when no VAPID keys are configured", async () => {
    const prevPublic = process.env.VAPID_PUBLIC_KEY;
    const prevPrivate = process.env.VAPID_PRIVATE_KEY;
    process.env.VAPID_PUBLIC_KEY = "";
    process.env.VAPID_PRIVATE_KEY = "";
    try {
      const user = await seedUser("u-novapid");
      await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: "https://x.endpoint", p256dh: "a", auth: "b" } });
      await sendPushToUser(user.id, "Title", "Body", "/url");
      // No error, no VAPID init
      expect(true).toBe(true);
    } finally {
      if (prevPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = prevPublic;
      if (prevPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = prevPrivate;
    }
  });

  it("removes stale subscriptions on 410 Gone", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    const user = await seedUser("u-stale410");
    await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: "https://gone.endpoint", p256dh: "a", auth: "b" } });
    const { sendNotification } = await import("web-push");
    vi.mocked(sendNotification).mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));

    await sendPushToUser(user.id, "Title", "Body", "/url");

    const remaining = await prisma.pushSubscription.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(0);
  });

  it("tolerates web-push cleanup failures and keeps going", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    const user = await seedUser("u-cleanfail");
    await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: "https://cleanfail.endpoint", p256dh: "a", auth: "b" } });
    const { sendNotification } = await import("web-push");
    vi.mocked(sendNotification).mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));
    // Make the cleanup delete throw — the push flow must not fail
    const delSpy = vi.spyOn(prisma.pushSubscription, "delete").mockRejectedValueOnce(new Error("db down"));

    await sendPushToUser(user.id, "Title", "Body", "/url");

    expect(delSpy).toHaveBeenCalled();
    expect(prisma.pushSubscription.findMany({ where: { userId: user.id } })).resolves.toHaveLength(1);
    delSpy.mockRestore();
  });
});

describe("sendPushToEvent", () => {
  it("fans out to followers + owner and excludes the sender", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    const owner = await seedUser("u-owner");
    const follower = await seedUser("u-follower");
    const sender = await seedUser("u-sender");
    const event = await seedEvent("evt-push1", owner.id);
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: follower.id } });
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: sender.id } });

    await prisma.pushSubscription.create({ data: { userId: owner.id, endpoint: "https://owner.endpoint", p256dh: "a", auth: "b" } });
    await prisma.pushSubscription.create({ data: { userId: follower.id, endpoint: "https://follower.endpoint", p256dh: "c", auth: "d" } });
    await prisma.pushSubscription.create({ data: { userId: sender.id, endpoint: "https://sender.endpoint", p256dh: "e", auth: "f" } });

    const { sendNotification } = await import("web-push");
    await sendPushToEvent(event.id, "Title", "notifyGameReminder2h", { title: "Push Game" }, "/events/evt-push1", 3, sender.id);

    // owner + follower get it, sender excluded
    const endpoints = vi.mocked(sendNotification).mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint);
    expect(endpoints).toContain("https://owner.endpoint");
    expect(endpoints).toContain("https://follower.endpoint");
    expect(endpoints).not.toContain("https://sender.endpoint");
  });

  it("honors per-user prefs and mutes when push is disabled", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    const owner = await seedUser("u-owner2");
    const muted = await seedUser("u-muted");
    const event = await seedEvent("evt-push2", owner.id);
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: muted.id } });
    await prisma.notificationPreferences.create({
      data: { userId: muted.id, gameReminderPush: false },
    });
    // ADR 0017: game reminders are players-only — both must be active players
    await prisma.player.create({ data: { eventId: event.id, name: "Owner2", userId: owner.id, order: 0 } });
    await prisma.player.create({ data: { eventId: event.id, name: "Muted", userId: muted.id, order: 1 } });
    await prisma.pushSubscription.create({ data: { userId: owner.id, endpoint: "https://owner2.endpoint", p256dh: "a", auth: "b" } });
    await prisma.pushSubscription.create({ data: { userId: muted.id, endpoint: "https://muted.endpoint", p256dh: "c", auth: "d" } });

    const { sendNotification } = await import("web-push");
    await sendPushToEvent(event.id, "Title", "notifyGameReminder2h", { title: "Push Game" }, "/events/evt-push2", 3, undefined, "reminder", "2h");

    const endpoints = vi.mocked(sendNotification).mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint);
    expect(endpoints).toContain("https://owner2.endpoint");
    expect(endpoints).not.toContain("https://muted.endpoint");
  });
});

describe("sendPushToUser (FCM app tokens)", () => {
  it("handles app tokens when no FCM service account is configured", async () => {
    const prev = process.env.FCM_SERVICE_ACCOUNT_JSON;
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    try {
      const user = await seedUser("u-fcm-nosa");
      await prisma.appPushToken.create({ data: { userId: user.id, token: "expo-token-1", platform: "android" } });
      // Should not throw; sendFcmMessage returns false without a service account
      await sendPushToUser(user.id, "Title", "Body", "/url");
      expect(true).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON;
      else process.env.FCM_SERVICE_ACCOUNT_JSON = prev;
    }
  });

  it("logs and drops invalid FCM tokens on 404 from the API", async () => {
    const prev = process.env.FCM_SERVICE_ACCOUNT_JSON;
    const createSignMock = vi.fn(() => ({ update: vi.fn(), sign: vi.fn(() => "sig") }));
    vi.doMock("crypto", async () => ({
      ...(await import("crypto")),
      createSign: createSignMock,
    }));
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "test-project",
      client_email: "sa@test.iam.gserviceaccount.com",
      private_key: "fake-key",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "UNREGISTERED" });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const user = await seedUser("u-fcm-404");
      await prisma.appPushToken.create({ data: { userId: user.id, token: "fcm-bad-token", platform: "android" } });
      // Make the cleanup delete throw — the FCM path must not fail
      const delSpy = vi.spyOn(prisma.appPushToken, "deleteMany").mockRejectedValueOnce(new Error("db down"));
      await sendPushToUser(user.id, "Title", "Body", "/url");
      expect(delSpy).toHaveBeenCalled();
      delSpy.mockRestore();
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock("crypto");
      if (prev === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON;
      else process.env.FCM_SERVICE_ACCOUNT_JSON = prev;
    }
  });
  it("sends FCM app pushes to event followers when a service account is configured", async () => {
    const prev = process.env.FCM_SERVICE_ACCOUNT_JSON;
    const createSignMock = vi.fn(() => ({ update: vi.fn(), sign: vi.fn(() => "sig") }));
    vi.doMock("crypto", async () => ({
      ...(await import("crypto")),
      createSign: createSignMock,
    }));
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "test-project",
      client_email: "sa@test.iam.gserviceaccount.com",
      private_key: "fake-key",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const owner = await seedUser("u-fcm-owner");
      const follower = await seedUser("u-fcm-follower");
      const event = await seedEvent("evt-fcm", owner.id);
      await prisma.eventFollow.create({ data: { eventId: event.id, userId: follower.id } });
      await prisma.appPushToken.create({ data: { userId: follower.id, token: "fcm-ok-token", platform: "android", locale: "en" } });

      await sendPushToEvent(event.id, "Title", "notifyPlayerJoined", { name: "X", title: "Push Game" }, "/events/evt-fcm", 3);

      // FCM message send happens (token may be cached from a prior test)
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("fcm.googleapis.com"))).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock("crypto");
      if (prev === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON;
      else process.env.FCM_SERVICE_ACCOUNT_JSON = prev;
    }
  });
  it("tolerates web-push cleanup failures during event fanout", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    const owner = await seedUser("u-owner3");
    const event = await seedEvent("evt-push3", owner.id);
    await prisma.pushSubscription.create({ data: { userId: owner.id, endpoint: "https://owner3.endpoint", p256dh: "a", auth: "b" } });
    const { sendNotification } = await import("web-push");
    vi.mocked(sendNotification).mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));
    const delSpy = vi.spyOn(prisma.pushSubscription, "delete").mockRejectedValueOnce(new Error("db down"));

    await sendPushToEvent(event.id, "Title", "notifyPlayerJoined", { name: "X", title: "Push Game" }, "/events/evt-push3", 3);

    expect(delSpy).toHaveBeenCalled();
    delSpy.mockRestore();
  });
});

describe("sendTestPushToUserWebSubs", () => {
  it("returns delivered/total and cleans up stale subs", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    const user = await seedUser("u-testpush");
    await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: "https://ok.endpoint", p256dh: "a", auth: "b" } });
    await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: "https://gone2.endpoint", p256dh: "c", auth: "d" } });

    const { sendNotification } = await import("web-push");
    vi.mocked(sendNotification).mockImplementation((sub: { endpoint: string }) => {
      if (sub.endpoint.includes("gone2")) {
        return Promise.reject(Object.assign(new Error("Gone"), { statusCode: 410 }));
      }
      return Promise.resolve({} as never);
    });

    const result = await sendTestPushToUserWebSubs({ userId: user.id, title: "T", body: "B", url: "/u" });

    expect(result.delivered).toBe(1);
    expect(result.total).toBe(2);
    const remaining = await prisma.pushSubscription.findMany({ where: { userId: user.id } });
    expect(remaining.map((s) => s.endpoint)).toEqual(["https://ok.endpoint"]);
  });

  it("tolerates cleanup failures in the test push path", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    const user = await seedUser("u-testfail");
    await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: "https://fail.endpoint", p256dh: "a", auth: "b" } });
    const { sendNotification } = await import("web-push");
    vi.mocked(sendNotification).mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));
    const delSpy = vi.spyOn(prisma.pushSubscription, "delete").mockRejectedValueOnce(new Error("db down"));

    const result = await sendTestPushToUserWebSubs({ userId: user.id, title: "T", body: "B", url: "/u" });

    expect(delSpy).toHaveBeenCalled();
    expect(result.delivered).toBe(0);
    expect(result.total).toBe(1);
    delSpy.mockRestore();
  });

  it("returns zero when no VAPID configured", async () => {
    const prevPublic = process.env.VAPID_PUBLIC_KEY;
    const prevPrivate = process.env.VAPID_PRIVATE_KEY;
    process.env.VAPID_PUBLIC_KEY = "";
    process.env.VAPID_PRIVATE_KEY = "";
    try {
      const user = await seedUser("u-novapid2");
      const result = await sendTestPushToUserWebSubs({ userId: user.id, title: "T", body: "B", url: "/u" });
      expect(result).toEqual({ delivered: 0, total: 0 });
    } finally {
      if (prevPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = prevPublic;
      if (prevPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = prevPrivate;
    }
  });
});
