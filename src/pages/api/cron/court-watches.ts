import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { watchQueries, matchWatchInCourts, type CourtWatchMatch } from "~/lib/standaloneCourtWatch.server";
import { fetchAvailabilityGrouped, availabilityKeyStr } from "~/lib/availabilityCache.server";
import { sendPushToUser } from "~/lib/push.server";
import { createLogger } from "~/lib/logger.server";

const log = createLogger("court-watches");
const CRON_SECRET = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
const APP_URL = import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.cabeda.dev";
const LOOKAHEAD_DAYS = 14;
// Max watches processed per invocation (oldest-checked first). Run the cron more
// often rather than processing everything in one long-running request.
const BATCH_SIZE = 200;
const CONCURRENCY = 5;

/**
 * Process standalone recurring court watches at scale:
 *  1. Take a bounded batch, oldest-checked first (chunked/idempotent).
 *  2. Collapse all watches into a unique set of (tenant, sport, date) queries.
 *  3. Fetch those once, cached + with bounded concurrency.
 *  4. Match each watch against the pre-fetched availability (pure, no network).
 *  5. Bulk-dedup + bulk-write hits/notifications; update lastCheckedAt.
 */
export const POST: APIRoute = async ({ request }) => {
  if (CRON_SECRET && request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 1. Bounded batch, oldest first (nulls — never checked — first)
  const watches = await prisma.courtWatch.findMany({
    where: { active: true },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: BATCH_SIZE,
  });

  if (watches.length === 0) return Response.json({ ok: true, processed: 0, results: [] });

  // 2. Unique availability queries across all watches
  const allKeys = watches.flatMap((w) => watchQueries(w, LOOKAHEAD_DAYS));

  // 3. Fetch once each, cached + concurrent
  const courtsByKey = await fetchAvailabilityGrouped(allKeys, { concurrency: CONCURRENCY });

  const results: Array<{ watchId: string; found: number }> = [];
  const newHits: Array<{ watchId: string; resourceId: string; slotDate: string; slotTime: string }> = [];
  const notifications: Array<{ userId: string; title: string; body: string; url: string; pushUrl: string }> = [];

  for (const watch of watches) {
    // 4. Pure matching against pre-fetched availability
    const matches: CourtWatchMatch[] = [];
    for (const key of watchQueries(watch, LOOKAHEAD_DAYS)) {
      const courts = courtsByKey.get(availabilityKeyStr(key));
      if (courts) matches.push(...matchWatchInCourts(watch, key.date, courts));
    }

    // 5a. Bulk dedup: load this watch's existing hits in one query
    const existing = await prisma.courtWatchHit.findMany({
      where: { watchId: watch.id },
      select: { resourceId: true, slotDate: true, slotTime: true },
    });
    const seen = new Set(existing.map((h) => `${h.resourceId}|${h.slotDate}|${h.slotTime}`));

    let found = 0;
    for (const m of matches) {
      const sig = `${m.resourceId}|${m.slotDate}|${m.slotTime}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      newHits.push({ watchId: watch.id, resourceId: m.resourceId, slotDate: m.slotDate, slotTime: m.slotTime });
      const priceLabel = m.price !== null && m.currency ? ` — ${m.price}${m.currency}` : "";
      notifications.push({
        userId: watch.userId,
        title: `🎾 Court available: ${watch.tenantName}`,
        body: `${m.resourceName} on ${m.slotDate} at ${m.slotTime}${priceLabel}`,
        url: "/court-watches",
        pushUrl: `${APP_URL}/court-watches`,
      });
      found++;
    }
    results.push({ watchId: watch.id, found });
  }

  // 5b. Bulk-write hits + in-app notifications
  if (newHits.length > 0) {
    await prisma.courtWatchHit.createMany({ data: newHits });
  }
  if (notifications.length > 0) {
    await prisma.inAppNotification.createMany({
      data: notifications.map((n) => ({ userId: n.userId, type: "court_watch_available", title: n.title, body: n.body, url: n.url })),
    });
    // Push is an external side-effect; fire after DB writes
    for (const n of notifications) {
      try {
        await sendPushToUser(n.userId, n.title, n.body, n.pushUrl);
      } catch (err) {
        log.error({ userId: n.userId, err }, "push failed");
      }
    }
  }

  // 5c. Mark this batch as checked
  await prisma.courtWatch.updateMany({
    where: { id: { in: watches.map((w) => w.id) } },
    data: { lastCheckedAt: new Date() },
  });

  return Response.json({ ok: true, processed: watches.length, found: newHits.length, results });
};
