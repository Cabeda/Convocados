import { prisma } from "./db.server";
import { createT, type Locale, type TranslationKey } from "./i18n";
import { createLogger } from "./logger.server";
import { DEFAULTS, wantsPushForJobType, wantsPushReminder } from "./notificationPrefs.server";
import type { NotificationJobType } from "./notificationQueue.server";
import pLimit from "p-limit";

const log = createLogger("push");

/** Max concurrent web-push sends per event to avoid overwhelming the connection pool */
const PUSH_CONCURRENCY = 20;

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
  if (
    !(import.meta.env.VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY) ||
    !(import.meta.env.VAPID_PRIVATE_KEY ?? process.env.VAPID_PRIVATE_KEY)
  ) return;

  await init();
  const webpush = await getWebPush();

  const subs = await prisma.pushSubscription.findMany({ where: { eventId } });

  const filtered = subs.filter(
    (sub) => !senderClientId || !sub.clientId || sub.clientId !== senderClientId,
  );

  if (filtered.length === 0) return;

  // Batch-load notification prefs for all linked users in one query
  // instead of N individual queries inside the fan-out loop.
  const linkedUserIds = [...new Set(filtered.map((s) => s.userId).filter(Boolean) as string[])];
  const prefsRows = linkedUserIds.length > 0
    ? await prisma.notificationPreferences.findMany({ where: { userId: { in: linkedUserIds } } })
    : [];
  const prefsMap = new Map(prefsRows.map((p) => [p.userId, { ...DEFAULTS, ...p }]));

  const limit = pLimit(PUSH_CONCURRENCY);

  await Promise.allSettled(
    filtered.map((sub) =>
      limit(async () => {
        // Respect per-user granular prefs when the subscription is linked to a user
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

/**
 * Send a push notification to all devices registered by a specific user.
 * Unlike sendPushToEvent (which fans out to all event subscribers), this
 * targets a single user across all their subscriptions — useful for
 * account-level notifications like admin role changes.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  url: string,
) {
  if (
    !(import.meta.env.VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY) ||
    !(import.meta.env.VAPID_PRIVATE_KEY ?? process.env.VAPID_PRIVATE_KEY)
  ) return;

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
}
