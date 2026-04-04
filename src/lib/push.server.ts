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

/**
 * ntfy server URL — defaults to the public ntfy.sh instance.
 * Self-host with `docker run -p 8090:80 binwiederhier/ntfy serve`
 * and set NTFY_URL=http://localhost:8090
 */
const NTFY_URL = process.env.NTFY_URL ?? "https://ntfy.sh";

/**
 * ntfy topic prefix — each user gets a topic like `convocados-<userId>`.
 * Set NTFY_TOPIC_PREFIX to customize (e.g. for self-hosted instances).
 */
const NTFY_TOPIC_PREFIX = process.env.NTFY_TOPIC_PREFIX ?? "convocados";

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

// ── ntfy Push (FOSS — no Google dependency) ───────────────────────────────

/**
 * Build the ntfy topic name for a user.
 * Each user gets a unique topic: `<prefix>-<userId>`
 */
function ntfyTopic(userId: string): string {
  return `${NTFY_TOPIC_PREFIX}-${userId}`;
}

/**
 * Send a push notification to a user via ntfy.
 * Works without Google Play Services — the mobile app subscribes via SSE.
 * Falls back gracefully if ntfy is unreachable.
 */
async function sendNtfyPush(
  userId: string,
  title: string,
  body: string,
  url: string,
): Promise<void> {
  const topic = ntfyTopic(userId);
  try {
    const res = await fetch(`${NTFY_URL}/${topic}`, {
      method: "POST",
      headers: {
        Title: title,
        Tags: "soccer",
        Click: url,
        "Content-Type": "text/plain",
      },
      body,
    });
    if (!res.ok) {
      log.error({ status: res.status, topic }, "ntfy push failed");
    } else {
      log.info({ topic }, "ntfy push sent");
    }
  } catch (err: unknown) {
    log.error({ err, topic }, "ntfy push error");
  }
}

/**
 * Get the ntfy topic URL for a user (used by the mobile app to subscribe).
 */
export function getNtfyTopicUrl(userId: string): string {
  return `${NTFY_URL}/${ntfyTopic(userId)}`;
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
 * Send a push notification to a user's mobile devices via Expo push.
 * Respects notification preferences.
 */
async function sendAppPushToUser(
  userId: string,
  title: string,
  body: string,
  url: string,
): Promise<void> {
  const tokens = await prisma.appPushToken.findMany({ where: { userId } });

  // Send via Expo Push (for devices with Google Play Services)
  if (tokens.length > 0) {
    const messages: ExpoPushMessage[] = tokens.map((t) => ({
      to: t.token,
      title,
      body,
      data: { url },
      sound: "default" as const,
      channelId: "default",
    }));
    await sendExpoPush(messages);
  }

  // Send via ntfy (FOSS — works without Google Play Services)
  await sendNtfyPush(userId, title, body, url);
}

/**
 * Send app push notifications to all users subscribed to an event.
 * Looks up users via PushSubscription (linked userId) and AppPushToken.
 */
async function sendAppPushToEventUsers(
  eventId: string,
  title: string,
  body: string,
  url: string,
  excludeUserIds: Set<string>,
  jobType?: NotificationJobType,
  reminderType?: "24h" | "2h" | "1h",
  prefsMap?: Map<string, typeof DEFAULTS>,
): Promise<void> {
  // Find all users subscribed to this event (via web push subs with linked userId)
  const subs = await prisma.pushSubscription.findMany({
    where: { eventId, userId: { not: null } },
    select: { userId: true },
  });
  const userIds = [...new Set(subs.map((s) => s.userId!).filter((id) => !excludeUserIds.has(id)))];
  if (userIds.length === 0) return;

  // Find app push tokens for these users
  const tokens = await prisma.appPushToken.findMany({
    where: { userId: { in: userIds } },
  });
  if (tokens.length === 0) return;

  // Filter by notification preferences
  const messages: ExpoPushMessage[] = [];
  for (const token of tokens) {
    if (prefsMap && jobType) {
      const prefs = prefsMap.get(token.userId) ?? DEFAULTS;
      if (!wantsPushForJobType(prefs, jobType)) continue;
      if (jobType === "reminder" && reminderType && !wantsPushReminder(prefs, reminderType)) continue;
    }
    messages.push({
      to: token.token,
      title,
      body,
      data: { url },
      sound: "default",
      channelId: "default",
    });
  }

  await sendExpoPush(messages);
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

  // Batch-load notification prefs for all linked users in one query
  const allLinkedUserIds = [...new Set(
    subs.map((s) => s.userId).filter(Boolean) as string[],
  )];
  const prefsRows = allLinkedUserIds.length > 0
    ? await prisma.notificationPreferences.findMany({ where: { userId: { in: allLinkedUserIds } } })
    : [];
  const prefsMap = new Map(prefsRows.map((p) => [p.userId, { ...DEFAULTS, ...p }]));

  // Build a default-locale body for the Expo push (mobile app tokens don't carry locale)
  const defaultT = createT("en");
  const defaultBody = defaultT(key, params);
  const defaultSuffix = spotsLeft === 0 ? defaultT("notifyGameFull") : defaultT("notifySpotsLeft", { n: spotsLeft });
  const appPushBody = `${defaultBody} · ${defaultSuffix}`;

  // Collect sender userIds so we can exclude them from app push too
  const senderUserIds = new Set<string>();
  if (senderClientId) {
    for (const sub of subs) {
      if (sub.clientId === senderClientId && sub.userId) senderUserIds.add(sub.userId);
    }
  }

  const promises: Promise<unknown>[] = [];

  // Expo app push fan-out (mobile devices) — always runs, no VAPID needed
  promises.push(
    sendAppPushToEventUsers(eventId, title, appPushBody, url, senderUserIds, jobType, reminderType, prefsMap),
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
  // Send to mobile app tokens (Expo push) — no VAPID keys required
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
