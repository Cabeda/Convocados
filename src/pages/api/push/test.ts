/**
 * POST /api/push/test — send a single test push to the caller's registered
 * web push subscriptions. Returns the number of subscriptions that accepted
 * the test, so the client can show a "you should see it any second" toast.
 *
 * No rate limiting needed — this is bounded by the caller's own subscription
 * count, which is small. Replay protection is via the Web Push service itself
 * (the service dedupes identical payloads sent within a short window).
 */
import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { createT, type Locale } from "~/lib/i18n";
import { sendTestPushToUserWebSubs } from "~/lib/push.server";

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const userId = session.user.id;

  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, locale: true },
  });

  if (subs.length === 0) {
    return Response.json({ ok: true, delivered: 0, total: 0 });
  }

  // Pick the most common locale among this user's subs for the test body.
  // The helper sends the same payload to every subscription, so we localize
  // once for the dominant locale. A user with mixed locales still gets a
  // meaningful (if possibly mistranslated) push.
  const counts = new Map<Locale, number>();
  for (const sub of subs) {
    const loc = (sub.locale as Locale) ?? "en";
    counts.set(loc, (counts.get(loc) ?? 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "en";
  const t = createT(dominant);
  const title = `${t("appName")} — ${t("enable")}`;
  const body = t("pushTestSent");
  const url = "/";

  const result = await sendTestPushToUserWebSubs({ userId, title, body, url });

  return Response.json({ ok: true, delivered: result.delivered, total: result.total });
};
