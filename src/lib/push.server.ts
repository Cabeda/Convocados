import { prisma } from "./db.server";
import { createT, type Locale, type TranslationKey } from "./i18n";
import { createLogger } from "./logger.server";

const log = createLogger("push");

let initialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _webpush: any = null;

async function getWebPush(): Promise<typeof import("web-push")> {
  if (!_webpush) {
    _webpush = await import("web-push");
  }
  return _webpush;
}

async function init() {
  if (initialized) return;
  initialized = true;
  const webpush = await getWebPush();
  webpush.setVapidDetails(
    "mailto:admin@convocados.fly.dev",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

export async function sendPushToEvent(
  eventId: string,
  title: string,
  key: TranslationKey,
  params: Record<string, string>,
  url: string,
  spotsLeft: number,
  senderClientId?: string,
) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  await init();
  const webpush = await getWebPush();
  const subs = await prisma.pushSubscription.findMany({ where: { eventId } });
  await Promise.allSettled(
    subs
      .filter((sub) => !senderClientId || !sub.clientId || sub.clientId !== senderClientId)
      .map(async (sub) => {
      const t = createT((sub.locale as Locale) ?? "en");
      const body = t(key, params);
      const suffix = spotsLeft === 0 ? t("notifyGameFull") : t("notifySpotsLeft", { n: spotsLeft });
      const payload = JSON.stringify({ title, body: `${body} · ${suffix}`, url });
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        log.info({ endpoint: sub.endpoint.slice(0, 50) }, "Push notification sent");
      } catch (err: any) {
        log.error({ endpoint: sub.endpoint.slice(0, 60), statusCode: err?.statusCode, err: err?.message }, "Push notification failed");
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }),
  );
}
