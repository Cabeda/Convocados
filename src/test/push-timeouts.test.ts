import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const mockSendNotification = vi.fn().mockResolvedValue({});
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mockSendNotification },
  setVapidDetails: vi.fn(),
  sendNotification: mockSendNotification,
}));

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getPushTimeoutCount,
  sendPushToEvent,
  sendPushToUser,
  sendTestPushToUserWebSubs,
} from "~/lib/push.server";

const FIVE_SECONDS_MS = 5_000;

function seedUser(id: string) {
  return prisma.user.upsert({
    where: { id },
    update: {},
    create: { id, name: `User ${id}`, email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(id: string, ownerId: string) {
  return prisma.event.upsert({
    where: { id },
    update: {},
    create: { id, title: "Push Timeout", location: "Pitch", dateTime: new Date(), ownerId },
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
  mockSendNotification.mockResolvedValue({});
  process.env.VAPID_PUBLIC_KEY = "test-public";
  process.env.VAPID_PRIVATE_KEY = "test-private";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("crypto");
  vi.restoreAllMocks();
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
});

describe("push sends are bounded in time", () => {
  it("passes an explicit timeout to both FCM fetches", async () => {
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
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    const user = await seedUser("u-fcm-timeout");
    await prisma.appPushToken.create({
      data: { userId: user.id, token: "fcm-token", platform: "android", locale: "en" },
    });

    await sendPushToUser(user.id, "Title", "Body", "/url");

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => new URL(url).host === "oauth2.googleapis.com")).toBe(true);
    expect(urls.some((url) => new URL(url).host === "fcm.googleapis.com")).toBe(true);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(timeoutSpy).toHaveBeenCalled();
    for (const call of timeoutSpy.mock.calls) {
      expect(call[0]).toBeLessThanOrEqual(FIVE_SECONDS_MS);
    }
  });

  it("passes an explicit timeout to every web-push send path", async () => {
    const user = await seedUser("u-web-timeout");
    const event = await seedEvent("evt-web-timeout", user.id);
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: user.id } });
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://timeout.endpoint", p256dh: "a", auth: "b", locale: "en" },
    });

    await sendPushToUser(user.id, "Title", "Body", "/url");
    await sendPushToEvent(event.id, "Title", "notifyGameReminder2h", { title: "Push Timeout" }, "/events/evt", 3);
    await sendTestPushToUserWebSubs({ userId: user.id, title: "Title", body: "Body", url: "/url" });

    expect(mockSendNotification).toHaveBeenCalled();
    for (const call of mockSendNotification.mock.calls) {
      const options = call[2] as { timeout?: number } | undefined;
      expect(options?.timeout).toBeGreaterThan(0);
      expect(options?.timeout).toBeLessThanOrEqual(FIVE_SECONDS_MS);
    }
  });

  it("counts web-push sends that time out", async () => {
    const user = await seedUser("u-web-count");
    const event = await seedEvent("evt-web-count", user.id);
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: user.id } });
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://count.endpoint", p256dh: "a", auth: "b", locale: "en" },
    });
    mockSendNotification.mockRejectedValue(new Error("Socket timeout"));

    const before = getPushTimeoutCount();
    await sendPushToUser(user.id, "Title", "Body", "/url");
    await sendPushToEvent(event.id, "Title", "notifyGameReminder2h", { title: "Push Timeout" }, "/events/evt", 3);
    await sendTestPushToUserWebSubs({ userId: user.id, title: "Title", body: "Body", url: "/url" });

    expect(getPushTimeoutCount()).toBeGreaterThanOrEqual(before + 3);
  });

  it("counts a send that times out", async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "test-project",
      client_email: "sa@test.iam.gserviceaccount.com",
      private_key: "fake-key",
    });
    const fetchMock = vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const before = getPushTimeoutCount();
    const user = await seedUser("u-fcm-count");
    await prisma.appPushToken.create({
      data: { userId: user.id, token: "fcm-count-token", platform: "android", locale: "en" },
    });

    await sendPushToUser(user.id, "Title", "Body", "/url");

    expect(getPushTimeoutCount()).toBe(before + 1);
  });
});
