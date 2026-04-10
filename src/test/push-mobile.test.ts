/**
 * Tests for mobile push notification delivery via FCM.
 *
 * Verifies that sendPushToEvent correctly delivers to mobile-only users
 * who have AppPushToken records but no web PushSubscription.
 * Also tests locale-based localization, sender exclusion via userId,
 * and sendPushToUser.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { prisma } from "~/lib/db.server";

// ── Mock fetch (FCM API + OAuth token exchange) ──────────────────────────────
const mockFetch = vi.fn().mockImplementation(async (url: string) => {
  if (typeof url === "string" && url.includes("oauth2.googleapis.com")) {
    // OAuth token exchange
    return { ok: true, json: async () => ({ access_token: "mock-fcm-token", expires_in: 3600 }) };
  }
  if (typeof url === "string" && url.includes("fcm.googleapis.com")) {
    // FCM send
    return { ok: true, json: async () => ({ name: "projects/test/messages/123" }) };
  }
  return { ok: true, json: async () => ({}) };
});
vi.stubGlobal("fetch", mockFetch);

// ── Set FCM service account so FCM code path is exercised ────────────────────
// We need a real RSA key for crypto.createSign — generate a minimal one
import { generateKeyPairSync } from "crypto";
const { privateKey: testPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: "test-project",
  client_email: "test@test.iam.gserviceaccount.com",
  private_key: testPrivateKey.export({ type: "pkcs8", format: "pem" }),
});

// ── Mock web-push (not needed for these tests) ───────────────────────────────
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({}),
  },
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn().mockResolvedValue({}),
}));

// Seed helpers
async function seedUser(id: string, name: string) {
  await prisma.user.upsert({
    where: { id },
    update: {},
    create: {
      id,
      name,
      email: `${id}@test.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return id;
}

async function seedEvent(ownerId: string, id = "evt-push-1") {
  await prisma.event.upsert({
    where: { id },
    update: {},
    create: {
      id,
      title: "Push Test Game",
      location: "Test Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 10,
      sport: "football-5v5",
      ownerId,
    },
  });
  return id;
}

/** Get all FCM fetch calls (calls to fcm.googleapis.com) */
function getFcmCalls() {
  return mockFetch.mock.calls.filter(
    (c: any[]) => typeof c[0] === "string" && c[0].includes("fcm.googleapis.com"),
  );
}

/** Extract FCM token from a fetch call body */
function getFcmToken(call: any[]): string {
  const body = JSON.parse(call[1].body);
  return body.message?.token ?? "";
}

/** Extract all FCM tokens from all FCM calls */
function getAllFcmTokens(): string[] {
  return getFcmCalls().map(getFcmToken);
}

beforeEach(async () => {
  mockFetch.mockClear();
  await prisma.notificationPreferences.deleteMany();
  await prisma.notificationJob.deleteMany();
  await prisma.appPushToken.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendPushToEvent — mobile app push delivery", () => {
  it("sends FCM push to mobile-only users who are players in the event", async () => {
    const ownerId = await seedUser("owner-1", "Owner");
    const playerId = await seedUser("player-1", "Mobile Player");
    const eventId = await seedEvent(ownerId);

    await prisma.player.create({
      data: { name: "Mobile Player", eventId, userId: playerId, order: 0 },
    });

    await prisma.appPushToken.create({
      data: { userId: playerId, token: "fcm-token-mobile-1", platform: "android" },
    });

    const { sendPushToEvent } = await import("~/lib/push.server");
    await sendPushToEvent(
      eventId,
      "Push Test Game",
      "notifyPlayerJoined",
      { name: "Someone" },
      `/events/${eventId}`,
      5,
    );

    expect(mockFetch).toHaveBeenCalled();
    const tokens = getAllFcmTokens();
    expect(tokens).toContain("fcm-token-mobile-1");
  });

  it("sends FCM push to event owner even without web subscription", async () => {
    const ownerId = await seedUser("owner-2", "Owner");
    const eventId = await seedEvent(ownerId);

    await prisma.appPushToken.create({
      data: { userId: ownerId, token: "fcm-token-owner-1", platform: "android" },
    });

    const { sendPushToEvent } = await import("~/lib/push.server");
    await sendPushToEvent(
      eventId,
      "Push Test Game",
      "notifyPlayerJoined",
      { name: "Someone" },
      `/events/${eventId}`,
      5,
    );

    expect(mockFetch).toHaveBeenCalled();
    const tokens = getAllFcmTokens();
    expect(tokens).toContain("fcm-token-owner-1");
  });

  it("excludes the sender from FCM push notifications", async () => {
    const ownerId = await seedUser("owner-3", "Owner");
    const senderId = await seedUser("sender-1", "Sender");
    const eventId = await seedEvent(ownerId, "evt-push-exclude");

    await prisma.player.create({
      data: { name: "Owner", eventId, userId: ownerId, order: 0 },
    });
    await prisma.player.create({
      data: { name: "Sender", eventId, userId: senderId, order: 1 },
    });

    await prisma.appPushToken.create({
      data: { userId: ownerId, token: "fcm-token-owner-excl", platform: "android" },
    });
    await prisma.appPushToken.create({
      data: { userId: senderId, token: "fcm-token-sender-excl", platform: "android" },
    });

    // Sender has a web push subscription with a clientId
    await prisma.pushSubscription.create({
      data: {
        eventId,
        endpoint: "https://push.example.com/sender",
        p256dh: "key1",
        auth: "auth1",
        locale: "en",
        clientId: "sender-client-123",
        userId: senderId,
      },
    });

    const { sendPushToEvent } = await import("~/lib/push.server");
    await sendPushToEvent(
      eventId,
      "Push Test Game",
      "notifyPlayerJoined",
      { name: "Someone" },
      `/events/${eventId}`,
      5,
      "sender-client-123",
    );

    const tokens = getAllFcmTokens();
    expect(tokens).not.toContain("fcm-token-sender-excl");
    expect(tokens).toContain("fcm-token-owner-excl");
  });

  it("does not send duplicate pushes when user has both web sub and app token", async () => {
    const ownerId = await seedUser("owner-4", "Owner");
    const userId = await seedUser("dual-user", "Dual User");
    const eventId = await seedEvent(ownerId, "evt-push-dedup");

    await prisma.player.create({
      data: { name: "Dual User", eventId, userId, order: 0 },
    });

    await prisma.pushSubscription.create({
      data: {
        eventId,
        endpoint: "https://push.example.com/dual",
        p256dh: "key2",
        auth: "auth2",
        locale: "en",
        clientId: "",
        userId,
      },
    });
    await prisma.appPushToken.create({
      data: { userId, token: "fcm-token-dual-1", platform: "android" },
    });

    const { sendPushToEvent } = await import("~/lib/push.server");
    await sendPushToEvent(
      eventId,
      "Push Test Game",
      "notifyPlayerJoined",
      { name: "Someone" },
      `/events/${eventId}`,
      5,
    );

    // FCM token should appear exactly once — no duplicates
    const tokens = getAllFcmTokens();
    const tokenCount = tokens.filter((t) => t === "fcm-token-dual-1").length;
    expect(tokenCount).toBe(1);
  });

  it("excludes sender when senderClientId is a userId (mobile app path)", async () => {
    const ownerId = await seedUser("owner-uid", "Owner");
    const senderId = await seedUser("sender-uid", "Mobile Sender");
    const eventId = await seedEvent(ownerId, "evt-uid-exclude");

    await prisma.player.create({
      data: { name: "Owner", eventId, userId: ownerId, order: 0 },
    });
    await prisma.player.create({
      data: { name: "Mobile Sender", eventId, userId: senderId, order: 1 },
    });

    await prisma.appPushToken.create({
      data: { userId: ownerId, token: "fcm-token-owner-uid", platform: "android" },
    });
    await prisma.appPushToken.create({
      data: { userId: senderId, token: "fcm-token-sender-uid", platform: "android" },
    });

    const { sendPushToEvent } = await import("~/lib/push.server");
    await sendPushToEvent(
      eventId,
      "Push Test Game",
      "notifyPlayerJoined",
      { name: "Mobile Sender" },
      `/events/${eventId}`,
      5,
      senderId, // userId used as senderClientId
    );

    const tokens = getAllFcmTokens();
    expect(tokens).not.toContain("fcm-token-sender-uid");
    expect(tokens).toContain("fcm-token-owner-uid");
  });

  it("localizes push body using token locale", async () => {
    const ownerId = await seedUser("owner-locale", "Owner");
    const ptUserId = await seedUser("pt-user", "Portuguese User");
    const eventId = await seedEvent(ownerId, "evt-locale");

    await prisma.player.create({
      data: { name: "Portuguese User", eventId, userId: ptUserId, order: 0 },
    });

    await prisma.appPushToken.create({
      data: { userId: ptUserId, token: "fcm-token-pt-1", platform: "android", locale: "pt" },
    });

    const { sendPushToEvent } = await import("~/lib/push.server");
    await sendPushToEvent(
      eventId,
      "Push Test Game",
      "notifyPlayerJoined",
      { name: "Someone" },
      `/events/${eventId}`,
      5,
    );

    const fcmCalls = getFcmCalls();
    expect(fcmCalls.length).toBeGreaterThanOrEqual(1);

    // Find the call for our token
    const ptCall = fcmCalls.find((c: any[]) => getFcmToken(c) === "fcm-token-pt-1");
    expect(ptCall).toBeDefined();

    const body = JSON.parse(ptCall![1].body);
    const notification = body.message?.notification;
    expect(notification).toBeDefined();
    // Body should contain the player name and spots left suffix
    expect(notification.body).toContain("Someone");
    expect(notification.body).toContain("·");
  });

  it("handles game full notification (spotsLeft = 0)", async () => {
    const ownerId = await seedUser("owner-full", "Owner");
    const playerId = await seedUser("player-full", "Player");
    const eventId = await seedEvent(ownerId, "evt-full");

    await prisma.player.create({
      data: { name: "Player", eventId, userId: playerId, order: 0 },
    });
    await prisma.appPushToken.create({
      data: { userId: playerId, token: "fcm-token-full-1", platform: "android" },
    });

    const { sendPushToEvent } = await import("~/lib/push.server");
    await sendPushToEvent(
      eventId,
      "Push Test Game",
      "notifyPlayerJoined",
      { name: "Last Player" },
      `/events/${eventId}`,
      0, // Game is full
    );

    const fcmCalls = getFcmCalls();
    expect(fcmCalls.length).toBeGreaterThanOrEqual(1);

    const fullCall = fcmCalls.find((c: any[]) => getFcmToken(c) === "fcm-token-full-1");
    expect(fullCall).toBeDefined();

    const body = JSON.parse(fullCall![1].body);
    const notification = body.message?.notification;
    expect(notification).toBeDefined();
    expect(notification.body).toContain("·");
  });
});

describe("sendPushToUser — direct user push", () => {
  it("sends FCM push to a specific user's devices", async () => {
    const userId = await seedUser("direct-user", "Direct User");

    await prisma.appPushToken.create({
      data: { userId, token: "fcm-token-direct-1", platform: "android" },
    });

    const { sendPushToUser } = await import("~/lib/push.server");
    await sendPushToUser(userId, "Test Title", "Test body message", "/test");

    const fcmCalls = getFcmCalls();
    expect(fcmCalls.length).toBeGreaterThanOrEqual(1);

    const directCall = fcmCalls.find((c: any[]) => getFcmToken(c) === "fcm-token-direct-1");
    expect(directCall).toBeDefined();

    const body = JSON.parse(directCall![1].body);
    expect(body.message.notification.title).toBe("Test Title");
    expect(body.message.notification.body).toBe("Test body message");
    expect(body.message.data.url).toBe("/test");
  });

  it("does nothing when user has no push tokens", async () => {
    const userId = await seedUser("no-token-user", "No Token User");

    const { sendPushToUser } = await import("~/lib/push.server");
    await sendPushToUser(userId, "Test", "Body", "/test");

    // No FCM calls should be made
    const fcmCalls = getFcmCalls();
    expect(fcmCalls.length).toBe(0);
  });

  it("sends to multiple devices for the same user", async () => {
    const userId = await seedUser("multi-device", "Multi Device");

    await prisma.appPushToken.create({
      data: { userId, token: "fcm-token-dev-1", platform: "android" },
    });
    await prisma.appPushToken.create({
      data: { userId, token: "fcm-token-dev-2", platform: "android" },
    });

    const { sendPushToUser } = await import("~/lib/push.server");
    await sendPushToUser(userId, "Multi", "Multi device test", "/multi");

    const tokens = getAllFcmTokens();
    expect(tokens).toContain("fcm-token-dev-1");
    expect(tokens).toContain("fcm-token-dev-2");
  });
});

describe("sendPushToEvent — notification preferences", () => {
  it("respects user notification preferences (opt-out)", async () => {
    const ownerId = await seedUser("owner-prefs", "Owner");
    const optOutId = await seedUser("optout-user", "Opt Out User");
    const eventId = await seedEvent(ownerId, "evt-prefs");

    await prisma.player.create({
      data: { name: "Opt Out User", eventId, userId: optOutId, order: 0 },
    });
    await prisma.appPushToken.create({
      data: { userId: optOutId, token: "fcm-token-optout-1", platform: "android" },
    });

    await prisma.notificationPreferences.create({
      data: {
        userId: optOutId,
        playerActivityPush: false,
      },
    });

    const { sendPushToEvent } = await import("~/lib/push.server");
    await sendPushToEvent(
      eventId,
      "Push Test Game",
      "notifyPlayerJoined",
      { name: "Someone" },
      `/events/${eventId}`,
      5,
      undefined,
      "player_joined",
    );

    const tokens = getAllFcmTokens();
    expect(tokens).not.toContain("fcm-token-optout-1");
  });
});
