import { prisma } from "./db.server";
import { getSession } from "./auth.helpers.server";
import { rateLimitResponse } from "./apiRateLimit.server";

/**
 * #1236 — the two payer check-in answers ("everyone paid" and "ask me again
 * in 24h") share the same prologue: rate limit, event lookup, session, body
 * parse, game lookup, payer authorisation and the "has this game happened
 * yet" guard. They differ only in what they do to the game afterwards, so
 * that prologue lives here and each endpoint stays a few lines.
 */

/** The event fields the check-in endpoints need. */
export interface PayerCheckInEvent {
  id: string;
  durationMinutes: number;
}

/** The game fields the check-in endpoints need. */
export interface PayerCheckInGame {
  id: string;
  eventId: string;
  dateTime: Date;
}

export type PayerCheckInRequest =
  | { ok: false; response: Response }
  | { ok: true; event: PayerCheckInEvent; game: PayerCheckInGame; userId: string };

/**
 * Resolve the caller's right to answer a game's check-in, or the Response to
 * return instead (404/401/400/403/409 — already built, just return it).
 */
export async function resolvePayerCheckInRequest(
  params: Record<string, string | undefined>,
  request: Request,
): Promise<PayerCheckInRequest> {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return { ok: false, response: limited };

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, response: Response.json({ error: "Not found." }, { status: 404 }) };

  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, response: Response.json({ error: "Authentication required." }, { status: 401 }) };
  }

  const body = await request.json();
  const gameId = String(body.gameId ?? "");
  if (!gameId) {
    return { ok: false, response: Response.json({ error: "gameId is required." }, { status: 400 }) };
  }

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      eventId: true,
      dateTime: true,
      payerEventPlayer: { select: { userId: true } },
    },
  });
  if (!game || game.eventId !== eventId) {
    return { ok: false, response: Response.json({ error: "Not found." }, { status: 404 }) };
  }
  if (game.payerEventPlayer?.userId !== userId) {
    return {
      ok: false,
      response: Response.json({ error: "Only the payer can do this." }, { status: 403 }),
    };
  }

  // Only a game that has actually happened can be answered. The occurrence's
  // own date plus the event duration, not event.dateTime — a recurring reset
  // moves that forward as soon as the game ends (#1236).
  const gameEnd = new Date(game.dateTime.getTime() + event.durationMinutes * 60_000);
  if (gameEnd.getTime() > Date.now()) {
    return {
      ok: false,
      response: Response.json({ error: "The game has not ended yet." }, { status: 409 }),
    };
  }

  return { ok: true, event: { id: event.id, durationMinutes: event.durationMinutes }, game, userId };
}
