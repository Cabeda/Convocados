import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { parseRecurrenceRule, nextOccurrence } from "../../../../lib/recurrence";
import { fireWebhooks } from "../../../../lib/webhook.server";
import { autoPriorityEnroll } from "../../../../lib/priority.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { checkAccess } from "../../../../lib/eventAccess";

export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      players: { orderBy: { order: "asc" } },
      teamResults: { include: { members: { orderBy: { order: "asc" } } } },
      owner: { select: { id: true, name: true } },
    },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // ── Access control ──────────────────────────────────────────────────────
  if (event.accessPassword) {
    const session = await getSession(request);
    const isInvited = session?.user
      ? (await prisma.eventInvite.count({ where: { eventId: event.id, userId: session.user.id } })) > 0
      : false;

    const access = checkAccess({
      eventOwnerId: event.ownerId,
      accessPassword: event.accessPassword,
      requestUserId: session?.user?.id ?? null,
      cookieHeader: request.headers.get("cookie"),
      eventId: event.id,
      isInvited,
    });

    if (!access.granted) {
      return Response.json({
        locked: true,
        id: event.id,
        title: event.title,
        hasPassword: true,
      });
    }
  }

  let wasReset = false;

  // Lazy recurrence reset — optimistic lock via compare-and-swap on nextResetAt.
  // Only the request that wins the updateMany (count=1) proceeds; concurrent
  // requests get count=0 and skip, preventing double-snapshots.
  if (event.isRecurring && event.nextResetAt && event.nextResetAt <= new Date()) {
    const rule = parseRecurrenceRule(event.recurrenceRule);
    if (rule) {
      const currentNextResetAt = event.nextResetAt;
      const newDateTime = nextOccurrence(event.dateTime, rule, new Date());
      const newNextResetAt = new Date(newDateTime.getTime() + 60 * 60 * 1000);

      // Atomically claim the reset — only one concurrent request will get count=1
      const claimed = await prisma.event.updateMany({
        where: { id: event.id, nextResetAt: currentNextResetAt },
        data: { nextResetAt: newNextResetAt },
      });

      if (claimed.count === 1) {
        const editableUntil = new Date(event.dateTime.getTime() + 7 * 24 * 60 * 60 * 1000);
        const teamsSnapshot = event.teamResults.length > 0
          ? JSON.stringify(event.teamResults.map((tr) => ({
              team: tr.name,
              players: tr.members.map((m) => ({ name: m.name, order: m.order })),
            })))
          : null;

        // Snapshot payments before reset
        const eventCost = await prisma.eventCost.findUnique({
          where: { eventId: event.id },
          include: { payments: true },
        });
        const paymentsSnapshot = eventCost && eventCost.payments.length > 0
          ? JSON.stringify(eventCost.payments.map((p) => ({
              playerName: p.playerName,
              amount: p.amount,
              status: p.status,
              method: p.method,
            })))
          : null;

        await prisma.$transaction([
          prisma.gameHistory.create({
            data: {
              eventId: event.id,
              dateTime: event.dateTime,
              teamOneName: event.teamOneName,
              teamTwoName: event.teamTwoName,
              teamsSnapshot,
              paymentsSnapshot,
              editableUntil,
            },
          }),
          prisma.player.deleteMany({ where: { eventId: event.id } }),
          prisma.teamResult.deleteMany({ where: { eventId: event.id } }),
          // Clear payments for the new occurrence (keep EventCost settings)
          ...(eventCost ? [prisma.playerPayment.deleteMany({ where: { eventCostId: eventCost.id } })] : []),
          prisma.event.update({
            where: { id: event.id },
            data: { dateTime: newDateTime },
          }),
        ]);

        wasReset = true;

        // Fire game_reset webhook (non-blocking)
        fireWebhooks(event.id, "game_reset", {
          newDateTime: newDateTime.toISOString(),
        }).catch(() => {});

        // Auto-enroll priority players for the new occurrence (non-blocking)
        autoPriorityEnroll(event.id).catch(() => {});
      }

      const fresh = await prisma.event.findUnique({
        where: { id: event.id },
        include: {
          players: { orderBy: { order: "asc" } },
          teamResults: { include: { members: { orderBy: { order: "asc" } } } },
        },
      });
      if (fresh) Object.assign(event, fresh);
    }
  }

  return Response.json({
    wasReset,
    ...event,
    accessPassword: undefined, // never expose the hash
    hasPassword: !!event.accessPassword,
    ownerId: event.ownerId ?? null,
    ownerName: event.owner?.name ?? null,
    dateTime: event.dateTime.toISOString(),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    nextResetAt: event.nextResetAt?.toISOString() ?? null,
    players: event.players.map((p) => ({ ...p, userId: p.userId ?? null, createdAt: p.createdAt.toISOString() })),
  });
};
