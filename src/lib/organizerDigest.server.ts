/**
 * ADR 0018 — Organizer daily digest.
 *
 * For owners/admins with digestMode=true, sends a single daily summary
 * instead of individual Tier 2 notifications. Critical events still break through.
 *
 * ponytail: runs once per cron cycle (~hourly). Checks if current time matches
 * the user's digestTime (±30min window). If so, generates and sends the summary.
 * Upgrade path: per-event digest vs global; timezone-aware scheduling.
 */
import { prisma } from "./db.server";
import { sendPushToUser } from "./push.server";
import { createLogger } from "./logger.server";

const log = createLogger("organizer-digest");

export interface DigestResult {
  sent: string[];
}

/**
 * Process organizer digests. Called from the cron.
 * Finds owners/admins with digestMode=true whose digestTime matches now (±30min).
 */
export async function processOrganizerDigests(): Promise<DigestResult> {
  const now = new Date();
  const currentMM = now.getMinutes();
  // Match if current time is within 30min of configured digestTime
  const result: DigestResult = { sent: [] };

  const digestUsers = await prisma.notificationPreferences.findMany({
    where: { digestMode: true },
    select: { userId: true, digestTime: true },
  });

  for (const du of digestUsers) {
    const [hh, mm] = (du.digestTime || "09:00").split(":").map(Number);
    // Check if we're within the 30-min window
    const targetMin = hh * 60 + mm;
    const currentMin = now.getHours() * 60 + currentMM;
    const diff = Math.abs(currentMin - targetMin);
    if (diff > 30 && diff < (24 * 60 - 30)) continue; // not in window

    // Find events this user owns or admins
    const ownedEvents = await prisma.event.findMany({
      where: {
        ownerId: du.userId,
        archivedAt: null,
        dateTime: { gt: now }, // only upcoming
      },
      select: { id: true, title: true, maxPlayers: true, dateTime: true },
    });

    const adminEvents = await prisma.eventAdmin.findMany({
      where: { userId: du.userId },
      include: {
        event: {
          select: { id: true, title: true, maxPlayers: true, dateTime: true, archivedAt: true },
        },
      },
    });
    const adminUpcoming = adminEvents
      .filter((a) => !a.event.archivedAt && a.event.dateTime > now)
      .map((a) => a.event);

    const allEvents = [...ownedEvents, ...adminUpcoming];
    // Dedup by id
    const seen = new Set<string>();
    const events = allEvents.filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });

    if (events.length === 0) continue;

    // Build digest for each event
    const lines: string[] = [];
    for (const event of events) {
      const playerCount = await prisma.player.count({ where: { eventId: event.id, archivedAt: null } });
      const spotsLeft = Math.max(0, event.maxPlayers - playerCount);

      // Pending payments
      const eventCost = await prisma.eventCost.findUnique({ where: { eventId: event.id } });
      let pendingPayments = 0;
      let sentPayments = 0;
      if (eventCost) {
        pendingPayments = await prisma.playerPayment.count({ where: { eventCostId: eventCost.id, status: "pending" } });
        sentPayments = await prisma.playerPayment.count({ where: { eventCostId: eventCost.id, status: "sent" } });
      }

      let line = `${event.title}: ${playerCount}/${event.maxPlayers}`;
      if (spotsLeft > 0) line += ` (${spotsLeft} open)`;
      if (pendingPayments > 0) line += ` · ${pendingPayments} pending`;
      if (sentPayments > 0) line += ` · ${sentPayments} to confirm`;
      lines.push(line);
    }

    const body = lines.join("\n");
    const title = `📋 Daily summary (${events.length} game${events.length > 1 ? "s" : ""})`;

    try {
      await sendPushToUser(du.userId, title, body, "/dashboard");
      result.sent.push(du.userId);
    } catch (err) {
      log.error({ userId: du.userId, err }, "Failed to send organizer digest");
    }
  }

  return result;
}
