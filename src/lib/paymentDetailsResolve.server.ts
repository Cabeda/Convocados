import { prisma } from "./db.server";
import { parsePaymentMethods, type PaymentMethod } from "./paymentMethods";

/**
 * Which account a Game's money should go to (ADR 0055).
 *
 * One resolver, so the `game_payer_set` announcement and the `payment_nudge`
 * chase can never disagree about where the money goes. Precedence, highest
 * first: the per-occurrence temporary override, the Payer's own details when
 * they have consented to share them, the Event's organizer-typed details, and
 * finally nothing at all.
 */

export type PaymentDetailsSource = "temp_override" | "payer" | "event" | "none";

export interface ResolvedPaymentDetails {
  methods: PaymentMethod[];
  source: PaymentDetailsSource;
}

export async function resolvePaymentDetails(
  eventId: string,
  gameId: string,
): Promise<ResolvedPaymentDetails> {
  const [game, eventCost] = await Promise.all([
    prisma.game.findUnique({
      where: { id: gameId },
      select: { payerEventPlayerId: true, payerStoodDownAt: true },
    }),
    prisma.eventCost.findUnique({
      where: { eventId },
      select: { paymentMethods: true, tempPaymentMethods: true },
    }),
  ]);

  const temp = parsePaymentMethods(eventCost?.tempPaymentMethods);
  if (temp.length > 0) {
    return { methods: temp, source: "temp_override" };
  }

  if (game?.payerEventPlayerId && !game.payerStoodDownAt) {
    const payer = await prisma.eventPlayer.findUnique({
      where: { id: game.payerEventPlayerId },
      select: { userId: true },
    });
    // A linked payer who has not shared (or has no) details must not silently
    // inherit the organizer's account: the UI asks them to add their own. An
    // external name has no profile to store against, so it keeps the Event's
    // organizer details as the collection account.
    if (payer?.userId) {
      const payerUser = await prisma.user.findUnique({
        where: { id: payer.userId },
        select: { paymentDetails: true, sharePaymentDetails: true },
      });
      // Consent gates publication: details on a profile are not consent to
      // broadcast them to an Event's subscriber URLs.
      if (payerUser?.sharePaymentDetails) {
        const own = parsePaymentMethods(payerUser.paymentDetails);
        if (own.length > 0) {
          return { methods: own, source: "payer" };
        }
      }
      return { methods: [], source: "none" };
    }
  }

  const eventMethods = parsePaymentMethods(eventCost?.paymentMethods);
  if (eventMethods.length > 0) {
    return { methods: eventMethods, source: "event" };
  }

  return { methods: [], source: "none" };
}
