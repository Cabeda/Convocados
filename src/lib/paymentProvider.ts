/**
 * Payment provider port (ADR 0038).
 *
 * Direct payments are optional and feature-detected: an instance with no
 * provider configured behaves exactly as today (the offline
 * pending → sent → paid flow). Two adapters satisfy this seam — a `Manual`
 * adapter (today's behaviour) and a `StripeConnect` adapter (destination
 * charges, EUR) — which is what makes the seam real rather than hypothetical.
 *
 * The port is deliberately small: create a hosted checkout for a player's
 * share, and parse a provider webhook back into a domain event. Everything
 * provider-specific stays behind it.
 */

export interface CheckoutRequest {
  eventId: string;
  gameId: string | null;
  eventPlayerId: string;
  amountCents: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  /** The organizer's merchant account the money settles to (ADR 0038 destination charge). */
  destinationAccountId?: string | null;
}

export interface CheckoutSession {
  provider: string;
  /** Hosted checkout URL to redirect the payer to. */
  url: string;
  /** Provider reference for the session (recorded on the ledger as externalId). */
  providerRef: string;
}

export type ProviderWebhookEvent =
  | {
      kind: "payment_succeeded";
      providerRef: string;
      eventId: string;
      gameId: string | null;
      eventPlayerId: string;
      amountCents: number;
      currency: string;
    }
  | { kind: "payment_failed"; providerRef: string }
  | { kind: "ignored"; providerRef: string };

export interface PaymentProvider {
  readonly id: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Verify + translate a provider webhook. Never throws on an unknown event. */
  parseWebhook(rawBody: string, signature: string | null): Promise<ProviderWebhookEvent>;
}

/** The offline provider: no online checkout; webhooks are ignored. */
export class ManualPaymentProvider implements PaymentProvider {
  readonly id = "manual";

  async createCheckout(_request: CheckoutRequest): Promise<CheckoutSession> {
    throw new Error("Manual payment provider cannot create an online checkout.");
  }

  async parseWebhook(_rawBody: string, _signature: string | null): Promise<ProviderWebhookEvent> {
    return { kind: "ignored", providerRef: "" };
  }
}
