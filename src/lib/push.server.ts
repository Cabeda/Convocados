import { prisma } from "./db.server";
import { createT, type Locale, type TranslationKey } from "./i18n";
import { createLogger } from "./logger.server";
import { DEFAULTS, wantsPushForJobType, wantsPushReminder } from "./notificationPrefs.server";
import type { NotificationJobType } from "./notificationQueue.server";
import pLimit from "p-limit";

const log = createLogger("push");

/** Max concurrent web-push sends per event to avoid overwhelming the connection pool */
const PUSH_CONCURRENCY = 20;

/** Expo push API endpoint */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Max tickets per Expo push request (Expo limit is 100) */
const EXPO_BATCH_SIZE = 100;

/** FCM HTTP v1 API endpoint */
const FCM_API_URL = "https://fcm.googleapis.com/v1/projects/{projectId}/messages:send";

let initialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _webpush: any = null;

async function getWebPush(): Promise<typeof import("web-push")> {
  if (!_webpush) {
    const mod = await import("web-push");
    _webpush = (mod as any).default ?? mod;
  }
  return _webpush;
}

async function init() {
  if (initialized) return;
  initialized = true;
  const webpush = await getWebPush();
  const publicKey = import.meta.env.VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY!;
  const privateKey = import.meta.env.VAPID_PRIVATE_KEY ?? process.env.VAPID_PRIVATE_KEY!;
  webpush.setVapidDetails("mailto:admin@convocados.fly.dev", publicKey, privateKey);
}

// ── FCM (Firebase Cloud Messaging) ────────────────────────────────────────────

interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let _fcmAccessToken: { token: string; expiresAt: number } | null = null;
let _fcmServiceAccount: FcmServiceAccount | null = null;

function getFcmServiceAccount(): FcmServiceAccount | null {
  if (_fcmServiceAccount) return _fcmServiceAccount;
  const raw = import.meta.env.FCM_SERVICE_ACCOUNT_JSON ?? process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    _fcmServiceAccount = JSON.parse(raw) as FcmServiceAccount;
    return _fcmServiceAccount;
  } catch {
    log.error("Failed to parse FCM_SERVICE_ACCOUNT_JSON");
    return null;
  }
}

/** Get an OAuth2 access token for FCM using the service account JWT */
async function getFcmAccessToken(): Promise<string | null> {
  if (_fcmAccessToken && Date.now() < _fcmAccessToken.expiresAt - 60_000) {
    return _fcmAccessToken.token;
  }

  const sa = getFcmServiceAccount();
  if (!sa) return null;

  try {
    // Build JWT for Google OAuth2
    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const now = Math.floor(Date.now() / 1000);
    const payload = btoa(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }));

    const { createSign } = await import("crypto");
    const sign = createSign("RSA-SHA256");
    sign.update(`${header}.${payload}`);
    const signature = sign.sign(sa.private_key, "base64url");

    const jwt = `${header}.${payload}.${signature}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!res.ok) {
      log.error({ status: res.status }, "Failed to get FCM access token");
      return null;
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    _fcmAccessToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return _fcmAccessToken.token;
  } catch (err) {
    log.error({ err }, "Failed to get FCM access token");
    return null;
  }
}

/** Send a push notification via FCM HTTP v1 API */
async function sendFcmMessage(token: string, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
  const sa = getFcmServiceAccount();
  if (!sa) return false;

  const accessToken = await getFcmAccessToken();
  if (!accessToken) return false;

  const url = FCM_API_URL.replace("{projectId}", sa.project_id);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data: data ?? {},
          android: {
            notification: { channel_id: "default", sound: "default" },
          },
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      // Token is invalid/expired — remove it
      if (res.status === 404 || res.status === 400 || errBody.includes("UNREGISTERED")) {
        log.info({ token: token.slice(0, 30) }, "Removing invalid FCM token");
        await prisma.appPushToken.deleteMany({ where: { token } }).catch(() => {});
      } else {
        log.error({ status: res.status, body: errBody.slice(0, 200) }, "FCM send failed");
      }
      return false;
    }

    return true;
  } catch (err) {
    log.error({ err }, "FCM send error");
    return false;
  }
}

/** Send FCM messages in batch */
async function sendFcmBatch(messages: { token: string; title: string; body: string; data?: Record<string, string> }[]): Promise<void> {
  if (messages.length === 0) return;
  const limit = pLimit(PUSH_CONCURRENCY);
  await Promise.allSettled(messages.map((m) => limit(() => sendFcmMessage(m.token, m.title, m.body, m.data))));
}

/** Check if a token is an Expo push token (vs a raw FCM token) */
function isExpoToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

// ── Expo Push (mobile app) ────────────────────────────────────────────────────

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: "default" | null;
  channelId?: string;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Send push notifications to Expo push tokens in batches.
 * Automatically removes invalid tokens (DeviceNotRegistered).
 */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<void> {
  if (messages.length === 0) return;

  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        log.error({ status: res.status, statusText: res.statusText }, "Expo push API error");
        continue;
      }

      const { data: tickets } = (await res.json()) as { data: ExpoPushTicket[] };

      // Clean up invalid tokens
      for (let j = 0; j < tickets.length; j++) {
        const ticket = tickets[j];
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          const token = batch[j].to;
          log.info({ token: token.slice(0, 30) }, "Removing invalid Expo push token");
          await prisma.appPushToken.deleteMany({ where: { token } }).catch(() => {});
        }
      }
    } catch (err: unknown) {
      log.error({ err }, "Failed to send Expo push batch");
    }
  }
}

/**
 * Clean up stale push tokens and subscriptions.
 * Called from the cron endpoint.
 *
 * - Deletes AppPushToken records not updated in 90+ days
 * - Deletes PushSubscription records not updated in 90+ days
 */
export async function cleanupStalePushTokens(): Promise<{ appTokens: number; webSubs: number }> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const { count: appTokens } = await prisma.appPushToken.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });

  const { count: webSubs } = await prisma.pushSubscription.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  if (appTokens > 0 || webSubs > 0) {
    log.info({ appTokens, webSubs }, "Cleaned up stale push tokens");
  }

  return { appTokens, webSubs };
}

/**
 * Send a push notification to a user's mobile devices.
 * Routes to Expo Push or FCM depending on the token format.
 */
async function sendAppPushToUser(
  userId: string,
  title: string,
  body: string,
  url: string,
): Promise<void> {
  const tokens = await prisma.appPushToken.findMany({ where: { userId } });
  if (tokens.length === 0) return;

  const expoMessages: ExpoPushMessage[] = [];
  const fcmMessages: { token: string; title: string; body: string; data?: Record<string, string> }[] = [];

  for (const t of tokens) {
    if (isExpoToken(t.token)) {
      expoMessages.push({ to: t.token, title, body, data: { url }, sound: "default", channelId: "default" });
    } else {
      fcmMessages.push({ token: t.token, title, body, data: { url } });
    }
  }

  await Promise.allSettled([sendExpoPush(expoMessages), sendFcmBatch(fcmMessages)]);
}

/**
 * Send app push notifications to all users associated with an event.
 *
 * Finds users via three sources (deduplicated):
 * 1. PushSubscription records linked to the event (web push subscribers)
 * 2. Player records linked to the event (players with userId)
 * 3. Event owner (ownerId)
 *
 * Routes to Expo Push or FCM depending on the token format.
 * Messages are localized per-token using the locale stored on AppPushToken.
 */
async function sendAppPushToEventUsers(
  eventId: string,
  title: string,
  key: TranslationKey,
  params: Record<string, string>,
  url: string,
  spotsLeft: number,
  excludeUserIds: Set<string>,
  jobType?: NotificationJobType,
  reminderType?: "24h" | "2h" | "1h",
  prefsMap?: Map<string, typeof DEFAULTS>,
): Promise<void> {
  // Source 1: users with web push subscriptions linked to this event
  const subs = await prisma.pushSubscription.findMany({
    where: { eventId, userId: { not: null } },
    select: { userId: true },
  });

  // Source 2: players in the event with linked accounts
  const players = await prisma.player.findMany({
    where: { eventId, userId: { not: null } },
    select: { userId: true },
  });

  // Source 3: event owner
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true },
  });

  // Merge and deduplicate all user IDs, excluding the sender
  const allUserIds = new Set<string>();
  for (const s of subs) if (s.userId) allUserIds.add(s.userId);
  for (const p of players) if (p.userId) allUserIds.add(p.userId);
  if (event?.ownerId) allUserIds.add(event.ownerId);

  // Remove excluded users (sender)
  for (const id of excludeUserIds) allUserIds.delete(id);

  const userIds = [...allUserIds];
  if (userIds.length === 0) return;

  // Find app push tokens for these users
  const tokens = await prisma.appPushToken.findMany({
    where: { userId: { in: userIds } },
  });
  if (tokens.length === 0) return;

  // Filter by notification preferences and build localized messages
  const expoMessages: ExpoPushMessage[] = [];
  const fcmMessages: { token: string; title: string; body: string; data?: Record<string, string> }[] = [];

  for (const token of tokens) {
    if (prefsMap && jobType) {
      const prefs = prefsMap.get(token.userId) ?? DEFAULTS;
      if (!wantsPushForJobType(prefs, jobType)) continue;
      if (jobType === "reminder" && reminderType && !wantsPushReminder(prefs, reminderType)) continue;
    }
    // Build localized body using the token's stored locale
    const t = createT(((token as any).locale as Locale) ?? "en");
    const body = t(key, params);
    const suffix = spotsLeft === 0 ? t("notifyGameFull") : t("notifySpotsLeft", { n: spotsLeft });
    const fullBody = `${body} · ${suffix}`;

    if (isExpoToken(token.token)) {
      expoMessages.push({
        to: token.token,
        title,
        body: fullBody,
        data: { url },
        sound: "default",
        channelId: "default",
      });
    } else {
      fcmMessages.push({ token: token.token, title, body: fullBody, data: { url } });
    }
  }

  await Promise.allSettled([sendExpoPush(expoMessages), sendFcmBatch(fcmMessages)]);
}

export async function sendPushToEvent(
  eventId: string,
  title: string,
  key: TranslationKey,
  params: Record<string, string>,
  url: string,
  spotsLeft: number,
  senderClientId?: string,
  jobType?: NotificationJobType,
  reminderType?: "24h" | "2h" | "1h",
) {
  const hasVapid = !!(
    (import.meta.env.VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY) &&
    (import.meta.env.VAPID_PRIVATE_KEY ?? process.env.VAPID_PRIVATE_KEY)
  );

  const subs = await prisma.pushSubscription.findMany({ where: { eventId } });

  const filtered = subs.filter(
    (sub) => !senderClientId || !sub.clientId || sub.clientId !== senderClientId,
  );

  // Collect ALL user IDs that will receive notifications (web + mobile + owner)
  // so we can batch-load prefs for everyone in one query.
  const webUserIds = new Set(
    subs.map((s) => s.userId).filter(Boolean) as string[],
  );
  const players = await prisma.player.findMany({
    where: { eventId, userId: { not: null } },
    select: { userId: true },
  });
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true },
  });
  const allUserIds = new Set(webUserIds);
  for (const p of players) if (p.userId) allUserIds.add(p.userId);
  if (event?.ownerId) allUserIds.add(event.ownerId);

  const allUserIdList = [...allUserIds];
  const prefsRows = allUserIdList.length > 0
    ? await prisma.notificationPreferences.findMany({ where: { userId: { in: allUserIdList } } })
    : [];
  const prefsMap = new Map(prefsRows.map((p) => [p.userId, { ...DEFAULTS, ...p }]));

  // Collect sender userIds so we can exclude them from app push too.
  // Sender is identified by senderClientId (web) or by userId from the
  // request header x-sender-user-id (mobile).
  const senderUserIds = new Set<string>();
  if (senderClientId) {
    // If senderClientId looks like a userId (not a web push clientId), add directly
    if (allUserIds.has(senderClientId)) {
      senderUserIds.add(senderClientId);
    }
    // Also check web push subscriptions for matching clientId
    for (const sub of subs) {
      if (sub.clientId === senderClientId && sub.userId) senderUserIds.add(sub.userId);
    }
  }

  const promises: Promise<unknown>[] = [];

  // App push fan-out (mobile devices) — FCM for native, Expo for legacy
  promises.push(
    sendAppPushToEventUsers(eventId, title, key, params, url, spotsLeft, senderUserIds, jobType, reminderType, prefsMap),
  );

  // Web push fan-out — requires VAPID keys
  if (hasVapid && filtered.length > 0) {
    await init();
    const webpush = await getWebPush();
    const limit = pLimit(PUSH_CONCURRENCY);

    promises.push(
      ...filtered.map((sub) =>
        limit(async () => {
          if (jobType && sub.userId) {
            const prefs = prefsMap.get(sub.userId) ?? DEFAULTS;
            if (!wantsPushForJobType(prefs, jobType)) return;
            if (jobType === "reminder" && reminderType && !wantsPushReminder(prefs, reminderType)) return;
          }

          const t = createT((sub.locale as Locale) ?? "en");
          const body = t(key, params);
          const suffix = spotsLeft === 0 ? t("notifyGameFull") : t("notifySpotsLeft", { n: spotsLeft });
          const pushPayload = JSON.stringify({ title, body: `${body} · ${suffix}`, url });

          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              pushPayload,
            );
            log.info({ endpoint: sub.endpoint.slice(0, 50) }, "Push notification sent");
          } catch (err: any) {
            log.error(
              { endpoint: sub.endpoint.slice(0, 60), statusCode: err?.statusCode, err: err?.message },
              "Push notification failed",
            );
            if (err?.statusCode === 410 || err?.statusCode === 404) {
              await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            }
          }
        }),
      ),
    );
  }

  await Promise.allSettled(promises);
}

/**
 * Send a push notification to all devices registered by a specific user.
 * Unlike sendPushToEvent (which fans out to all event subscribers), this
 * targets a single user across all their subscriptions — useful for
 * account-level notifications like admin role changes.
 *
 * Sends to both web push (PushSubscription) and mobile app (AppPushToken).
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  url: string,
) {
  // Send to mobile app tokens (FCM for native, Expo for legacy)
  const appPushPromise = sendAppPushToUser(userId, title, body, url);

  // Send to web push subscriptions — requires VAPID keys
  let webPushPromise: Promise<void> = Promise.resolve();
  if (
    (import.meta.env.VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY) &&
    (import.meta.env.VAPID_PRIVATE_KEY ?? process.env.VAPID_PRIVATE_KEY)
  ) {
    webPushPromise = (async () => {
      await init();
      const webpush = await getWebPush();

      // Deduplicate by endpoint — a user may have subscribed the same device to multiple events
      const allSubs = await prisma.pushSubscription.findMany({ where: { userId } });
      const seen = new Set<string>();
      const subs = allSubs.filter((s) => {
        if (seen.has(s.endpoint)) return false;
        seen.add(s.endpoint);
        return true;
      });

      if (subs.length === 0) return;

      const limit = pLimit(PUSH_CONCURRENCY);
      const pushPayload = JSON.stringify({ title, body, url });

      await Promise.allSettled(
        subs.map((sub) =>
          limit(async () => {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                pushPayload,
              );
              log.info({ endpoint: sub.endpoint.slice(0, 50), userId }, "User push sent");
            } catch (err: any) {
              log.error(
                { endpoint: sub.endpoint.slice(0, 60), statusCode: err?.statusCode, err: err?.message, userId },
                "User push failed",
              );
              if (err?.statusCode === 410 || err?.statusCode === 404) {
                await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
              }
            }
          }),
        ),
      );
    })();
  }

  await Promise.allSettled([webPushPromise, appPushPromise]);
}
