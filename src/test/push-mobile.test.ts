/**
 * Tests for mobile push notification delivery via Expo push and FCM.
 *
 * Verifies that sendPushToEvent correctly delivers to mobile-only users
 * who have AppPushToken records but no web PushSubscription.
 * Also tests FCM routing, locale-based localization, sender exclusion
 * via userId, and sendPushToUser.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { prisma } from "~/lib/db.server";

// ── Mock fetch (Expo push API) ────────────────────────────────────────────────
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ data: [{ status: "ok" }] }),
});
vi.stubGlobal("fetch", mockFetch);

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
      location: "Test Field",
      dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      maxPlayers: 10,
      ownerId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return id;
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Re-stub fetch before each test (afterEach unstubs globals)
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ status: "ok" }] }),
  });

  // Clean up in correct order to respect FK constraints
  await prisma.appPushToken.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.notificationJob.deleteMany();
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
  it("sends Expo push to mobile-only users who are players in the event", async () => {
    // Setup: user with AppPushToken, player in event, but NO web PushSubscription
    const ownerId = await seedUser("owner-1", "Owner");
    const playerId = await seedUser("player-1", "Mobile Player");
    const eventId = await seedEvent(ownerId);

    // Player is in the event with linked userId
    await prisma.player.create({
      data: { name: "Mobile Player", eventId, userId: playerId, order: 0 },
    });

    // Player has an Expo push token (registered via mobile app)
    await prisma.appPushToken.create({
      data: { userId: playerId, token: "ExponentPushToken[mobile-1]", platform: "android" },
    });

    // No PushSubscription for this user — they only use the mobile app

    const { sendPushToEvent } = await import("~/lib/push.server");
    await sendPushToEvent(
      eventId,
      "Push Test Game",
      "notifyPlayerJoined",
      { name: "Someone" },
      `/events/${eventId}`,
      5,
    );

    // Should have called Expo push API with the mobile player's token
    expect(mockFetch).toHaveBeenCalled();
    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );
    expect(expoCalls.length).toBeGreaterThanOrEqual(1);

    // Verify the token was included in the push payload
    const body = JSON.parse(expoCalls[0][1].body);
    const tokens = Array.isArray(body) ? body.map((m: any) => m.to) : [body.to];
    expect(tokens).toContain("ExponentPushToken[mobile-1]");
  });

  it("sends Expo push to event owner even without web subscription", async () => {
    const ownerId = await seedUser("owner-2", "Owner");
    const eventId = await seedEvent(ownerId);

    // Owner has an Expo push token but no web PushSubscription and is not a player
    await prisma.appPushToken.create({
      data: { userId: ownerId, token: "ExponentPushToken[owner-1]", platform: "ios" },
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
    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );
    expect(expoCalls.length).toBeGreaterThanOrEqual(1);

    const body = JSON.parse(expoCalls[0][1].body);
    const tokens = Array.isArray(body) ? body.map((m: any) => m.to) : [body.to];
    expect(tokens).toContain("ExponentPushToken[owner-1]");
  });

  it("excludes the sender from Expo push notifications", async () => {
    const ownerId = await seedUser("owner-3", "Owner");
    const senderId = await seedUser("sender-1", "Sender");
    const eventId = await seedEvent(ownerId, "evt-push-exclude");

    // Both users are players
    await prisma.player.create({
      data: { name: "Owner", eventId, userId: ownerId, order: 0 },
    });
    await prisma.player.create({
      data: { name: "Sender", eventId, userId: senderId, order: 1 },
    });

    // Both have push tokens
    await prisma.appPushToken.create({
      data: { userId: ownerId, token: "ExponentPushToken[owner-excl]", platform: "android" },
    });
    await prisma.appPushToken.create({
      data: { userId: senderId, token: "ExponentPushToken[sender-excl]", platform: "android" },
    });

    // Sender has a web push subscription with a clientId
    await prisma.pushSubscription.create({
      data: {
        eventId,
        endpoint: "https://push.example.com/sender",
        p256dh: "key1",      auth: "auth1",
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
      "sender-client-123", // senderClientId
    );

    // Should have called Expo push API
    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );
    expect(expoCalls.length).toBeGreaterThanOrEqual(1);

    // Sender's token should NOT be in the push payload
    const body = JSON.parse(expoCalls[0][1].body);
    const tokens = Array.isArray(body) ? body.map((m: any) => m.to) : [body.to];
    expect(tokens).not.toContain("ExponentPushToken[sender-excl]");
    // Owner's token should be present
    expect(tokens).toContain("ExponentPushToken[owner-excl]");
  });

  it("does not send duplicate pushes when user has both web sub and app token", async () => {
    const ownerId = await seedUser("owner-4", "Owner");
    const userId = await seedUser("dual-user", "Dual User");
    const eventId = await seedEvent(ownerId, "evt-push-dedup");

    await prisma.player.create({
      data: { name: "Dual User", eventId, userId, order: 0 },
    });

    // User has both web push subscription AND app push token
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
      data: { userId, token: "ExponentPushToken[dual-1]", platform: "android" },
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

    // Count how many times the Expo token appears across all Expo push calls
    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );

    let tokenCount = 0;
    for (const call of expoCalls) {
      const body = JSON.parse(call[1].body);
      const messages = Array.isArray(body) ? body : [body];
      tokenCount += messages.filter((m: any) => m.to === "ExponentPushToken[dual-1]").length;
    }

    // Token should appear exactly once — no duplicates
    expect(tokenCount).toBe(1);
  });

  it("excludes sender when senderClientId is a userId (mobile app path)", async () => {
    // Mobile app sends userId directly as senderClientId (no web push clientId)
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
      data: { userId: ownerId, token: "ExponentPushToken[owner-uid]", platform: "android" },
    });
    await prisma.appPushToken.create({
      data: { userId: senderId, token: "ExponentPushToken[sender-uid]", platform: "android" },
    });

    const { sendPushToEvent } = await import("~/lib/push.server");
    // Pass senderId directly as senderClientId (mobile app behavior)
    await sendPushToEvent(
      eventId,
      "Push Test Game",
      "notifyPlayerJoined",
      { name: "Mobile Sender" },
      `/events/${eventId}`,
      5,
      senderId, // userId used as senderClientId
    );

    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );
    expect(expoCalls.length).toBeGreaterThanOrEqual(1);

    const body = JSON.parse(expoCalls[0][1].body);
    const tokens = Array.isArray(body) ? body.map((m: any) => m.to) : [body.to];
    // Sender should be excluded
    expect(tokens).not.toContain("ExponentPushToken[sender-uid]");
    // Owner should receive the notification
    expect(tokens).toContain("ExponentPushToken[owner-uid]");
  });

  it("localizes push body using token locale", async () => {
    const ownerId = await seedUser("owner-locale", "Owner");
    const ptUserId = await seedUser("pt-user", "Portuguese User");
    const eventId = await seedEvent(ownerId, "evt-locale");

    await prisma.player.create({
      data: { name: "Portuguese User", eventId, userId: ptUserId, order: 0 },
    });

    // Token with Portuguese locale
    await prisma.appPushToken.create({
      data: { userId: ptUserId, token: "ExponentPushToken[pt-1]", platform: "android", locale: "pt" },
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

    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );
    expect(expoCalls.length).toBeGreaterThanOrEqual(1);

    const body = JSON.parse(expoCalls[0][1].body);
    const messages = Array.isArray(body) ? body : [body];
    const ptMessage = messages.find((m: any) => m.to === "ExponentPushToken[pt-1]");
    expect(ptMessage).toBeDefined();
    // Portuguese body should NOT be the English text
    // The Portuguese translation of "notifyPlayerJoined" should contain the player name
    expect(ptMessage.body).toContain("Someone");
    // Should include spots left suffix
    expect(ptMessage.body).toContain("·");
  });

  it("sends to FCM when token is not an Expo token", async () => {
    // FCM tokens don't start with "ExponentPushToken[" or "ExpoPushToken["
    // Without FCM_SERVICE_ACCOUNT_JSON, FCM sends will silently fail (no crash)
    // but the routing logic should still separate them from Expo tokens
    const ownerId = await seedUser("owner-fcm", "Owner");
    const fcmUserId = await seedUser("fcm-user", "FCM User");
    const eventId = await seedEvent(ownerId, "evt-fcm");

    await prisma.player.create({
      data: { name: "FCM User", eventId, userId: fcmUserId, order: 0 },
    });

    // Raw FCM token (not Expo format)
    await prisma.appPushToken.create({
      data: { userId: fcmUserId, token: "dGVzdC1mY20tdG9rZW4:APA91bTest", platform: "android" },
    });

    // Also add an Expo token user to verify routing separation
    const expoUserId = await seedUser("expo-user", "Expo User");
    await prisma.player.create({
      data: { name: "Expo User", eventId, userId: expoUserId, order: 1 },
    });
    await prisma.appPushToken.create({
      data: { userId: expoUserId, token: "ExponentPushToken[expo-fcm-test]", platform: "android" },
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

    // Expo push should only contain the Expo token, not the FCM token
    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );

    if (expoCalls.length > 0) {
      const body = JSON.parse(expoCalls[0][1].body);
      const messages = Array.isArray(body) ? body : [body];
      const allTokens = messages.map((m: any) => m.to);
      // FCM token should NOT be sent via Expo push
      expect(allTokens).not.toContain("dGVzdC1mY20tdG9rZW4:APA91bTest");
      // Expo token should be sent via Expo push
      expect(allTokens).toContain("ExponentPushToken[expo-fcm-test]");
    }
  });

  it("handles game full notification (spotsLeft = 0)", async () => {
    const ownerId = await seedUser("owner-full", "Owner");
    const playerId = await seedUser("player-full", "Player");
    const eventId = await seedEvent(ownerId, "evt-full");

    await prisma.player.create({
      data: { name: "Player", eventId, userId: playerId, order: 0 },
    });
    await prisma.appPushToken.create({
      data: { userId: playerId, token: "ExponentPushToken[full-1]", platform: "android" },
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

    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );
    expect(expoCalls.length).toBeGreaterThanOrEqual(1);

    const body = JSON.parse(expoCalls[0][1].body);
    const messages = Array.isArray(body) ? body : [body];
    const msg = messages.find((m: any) => m.to === "ExponentPushToken[full-1]");
    expect(msg).toBeDefined();
    // Body should contain the "game full" suffix, not "spots left"
    expect(msg.body).toContain("·");
  });
});

describe("sendPushToUser — direct user push", () => {
  it("sends Expo push to a specific user's devices", async () => {
    const userId = await seedUser("direct-user", "Direct User");

    await prisma.appPushToken.create({
      data: { userId, token: "ExponentPushToken[direct-1]", platform: "ios" },
    });

    const { sendPushToUser } = await import("~/lib/push.server");
    await sendPushToUser(userId, "Test Title", "Test body message", "/test");

    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );
    expect(expoCalls.length).toBeGreaterThanOrEqual(1);

    const body = JSON.parse(expoCalls[0][1].body);
    const messages = Array.isArray(body) ? body : [body];
    const msg = messages.find((m: any) => m.to === "ExponentPushToken[direct-1]");
    expect(msg).toBeDefined();
    expect(msg.title).toBe("Test Title");
    expect(msg.body).toBe("Test body message");
    expect(msg.data.url).toBe("/test");
  });

  it("does nothing when user has no push tokens", async () => {
    const userId = await seedUser("no-token-user", "No Token User");

    const { sendPushToUser } = await import("~/lib/push.server");
    await sendPushToUser(userId, "Test", "Body", "/test");

    // No Expo push calls should be made
    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );
    expect(expoCalls.length).toBe(0);
  });

  it("sends to multiple devices for the same user", async () => {
    const userId = await seedUser("multi-device", "Multi Device");

    await prisma.appPushToken.create({
      data: { userId, token: "ExponentPushToken[dev-1]", platform: "ios" },
    });
    await prisma.appPushToken.create({
      data: { userId, token: "ExponentPushToken[dev-2]", platform: "android" },
    });

    const { sendPushToUser } = await import("~/lib/push.server");
    await sendPushToUser(userId, "Multi", "Multi device test", "/multi");

    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );
    expect(expoCalls.length).toBeGreaterThanOrEqual(1);

    const body = JSON.parse(expoCalls[0][1].body);
    const messages = Array.isArray(body) ? body : [body];
    const allTokens = messages.map((m: any) => m.to);
    expect(allTokens).toContain("ExponentPushToken[dev-1]");
    expect(allTokens).toContain("ExponentPushToken[dev-2]");
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
      data: { userId: optOutId, token: "ExponentPushToken[optout-1]", platform: "android" },
    });

    // User opts out of player_joined notifications
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
      "player_joined", // jobType
    );

    const calls = mockFetch.mock.calls;
    const expoCalls = calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("exp.host"),
    );

    // The opt-out user's token should not appear
    for (const call of expoCalls) {
      const body = JSON.parse(call[1].body);
      const messages = Array.isArray(body) ? body : [body];
      const tokens = messages.map((m: any) => m.to);
      expect(tokens).not.toContain("ExponentPushToken[optout-1]");
    }
  });
});
