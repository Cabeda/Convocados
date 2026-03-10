import webpush from "web-push";
import { prisma } from "./db.server";
import { createT, type Locale, type TranslationKey } from "./i18n";

let initialized = false;
function init() {
  if (initialized) return;
  initialized = true;
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
  init();
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
        console.log("[push] sent ok to", sub.endpoint.slice(0, 50));
      } catch (err: any) {
        console.error("[push] failed to send to", sub.endpoint.slice(0, 60), err?.statusCode, err?.message, err?.body);
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }),
  );
}
