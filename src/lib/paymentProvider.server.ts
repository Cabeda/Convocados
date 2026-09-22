/**
 * Payment provider selection + the Stripe Connect adapter (ADR 0038).
 *
 * Feature-detected: with no `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` the app
 * gets the `ManualPaymentProvider` and behaves exactly as before. The Stripe
 * adapter uses the REST API directly (no SDK) and Stripe's HMAC webhook scheme.
 */
import crypto from "node:crypto";
import {
  ManualPaymentProvider,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider,
  type ProviderWebhookEvent,
} from "./paymentProvider";

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

export class StripeConnectProvider implements PaymentProvider {
  readonly id = "stripe";

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", request.successUrl);
    params.set("cancel_url", request.cancelUrl);
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", request.currency.toLowerCase());
    params.set("line_items[0][price_data][unit_amount]", String(Math.round(request.amountCents)));
    params.set("line_items[0][price_data][product_data][name]", request.description);
    params.set("metadata[eventId]", request.eventId);
    params.set("metadata[eventPlayerId]", request.eventPlayerId);
    if (request.gameId) params.set("metadata[gameId]", request.gameId);
    if (request.destinationAccountId) {
      params.set("payment_intent_data[transfer_data][destination]", request.destinationAccountId);
      params.set("payment_intent_data[on_behalf_of]", request.destinationAccountId);
    }

    const res = await this.fetchImpl(STRIPE_API, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      throw new Error(`Stripe checkout session failed (${res.status})`);
    }
    const json = (await res.json()) as { id: string; url: string };
    return { provider: this.id, url: json.url, providerRef: json.id };
  }

  async parseWebhook(rawBody: string, signature: string | null): Promise<ProviderWebhookEvent> {
    if (!verifyStripeSignature(rawBody, signature, this.webhookSecret)) {
      throw new Error("Invalid Stripe webhook signature.");
    }
    const event = JSON.parse(rawBody) as {
      id: string;
      type: string;
      data?: { object?: { id?: string; amount_total?: number; currency?: string; metadata?: Record<string, string> } };
    };
    const object = event.data?.object;
    const providerRef = object?.id ?? event.id;
    const meta = object?.metadata ?? {};

    if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
      if (!meta.eventId || !meta.eventPlayerId) return { kind: "ignored", providerRef };
      return {
        kind: "payment_succeeded",
        providerRef,
        eventId: meta.eventId,
        gameId: meta.gameId ?? null,
        eventPlayerId: meta.eventPlayerId,
        amountCents: object?.amount_total ?? 0,
        currency: (object?.currency ?? "eur").toUpperCase(),
      };
    }
    if (event.type === "checkout.session.expired" || event.type === "payment_intent.payment_failed") {
      return { kind: "payment_failed", providerRef };
    }
    return { kind: "ignored", providerRef };
  }
}

/**
 * Verify Stripe's `Stripe-Signature: t=<ts>,v1=<sig>` header over
 * `<ts>.<rawBody>` with the endpoint's signing secret.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k.trim(), (v ?? "").trim()];
    }),
  );
  const timestamp = parts.t;
  const provided = parts.v1;
  if (!timestamp || !provided) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Select the provider for this instance. Stripe when configured, else Manual —
 * so an unconfigured instance keeps today's offline behaviour (ADR 0010/0038).
 */
export function getPaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (secretKey && webhookSecret) return new StripeConnectProvider(secretKey, webhookSecret);
  return new ManualPaymentProvider();
}
