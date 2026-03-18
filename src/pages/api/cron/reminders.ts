import type { APIRoute } from "astro";
import { getUpcomingReminders, markReminderSent } from "~/lib/reminders.server";
import { sendPushToEvent } from "~/lib/push.server";

const CRON_SECRET = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;

export const POST: APIRoute = async ({ request }) => {
  if (CRON_SECRET && request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sent: string[] = [];
  for (const type of ["24h", "2h", "1h"] as const) {
    const reminders = await getUpcomingReminders(type);
    for (const r of reminders) {
      try {
        await sendPushToEvent(r.eventId, "Reminder", "notifyReminder" as any, { title: r.eventTitle }, `/events/${r.eventId}`, 0);
        await markReminderSent(r.eventId, type);
        sent.push(`${r.eventId}:${type}`);
      } catch (err) {
        console.error(`[cron] Failed to send ${type} reminder for ${r.eventId}:`, err);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), {
    headers: { "Content-Type": "application/json" },
  });
};
