import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { ManualPaymentProvider } from "~/lib/paymentProvider";
import {
  StripeConnectProvider,
  getPaymentProvider,
  verifyStripeSignature,
} from "~/lib/paymentProvider.server";

const SECRET = "whsec_test";
const KEY = "sk_test_123";

function sign(rawBody: string, secret = SECRET, ts = "1700000000") {
  const v1 = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

describe("ManualPaymentProvider", () => {
  it("cannot create an online checkout", async () => {
    await expect(
      new ManualPaymentProvider().createCheckout({
        eventId: "e",
        gameId: null,
        eventPlayerId: "ep",
        amountCents: 1,
        currency: "EUR",
        description: "x",
        successUrl: "s",
        cancelUrl: "c",
      }),
    ).rejects.toThrow(/cannot create an online checkout/i);
  });

  it("ignores webhooks", async () => {
    expect(await new ManualPaymentProvider().parseWebhook("{}", null)).toEqual({ kind: "ignored", providerRef: "" });
  });
});

describe("getPaymentProvider", () => {
  it("returns Manual when Stripe is not configured", () => {
    expect(getPaymentProvider({} as NodeJS.ProcessEnv).id).toBe("manual");
  });

  it("returns Stripe when both secrets are present", () => {
    expect(getPaymentProvider({ STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv).id).toBe("stripe");
  });
});

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed payload", () => {
    const body = '{"id":"evt_1"}';
    expect(verifyStripeSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body or wrong secret", () => {
    const body = '{"id":"evt_1"}';
    expect(verifyStripeSignature('{"id":"evt_2"}', sign(body), SECRET)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, "other"), SECRET)).toBe(false);
    expect(verifyStripeSignature(body, null, SECRET)).toBe(false);
  });
});

describe("StripeConnectProvider.parseWebhook", () => {
  const provider = new StripeConnectProvider(KEY, SECRET);

  it("maps a completed checkout to payment_succeeded using metadata", async () => {
    const body = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", amount_total: 550, currency: "eur", metadata: { eventId: "e1", gameId: "g1", eventPlayerId: "ep1" } } },
    });
    const event = await provider.parseWebhook(body, sign(body));
    expect(event).toEqual({ kind: "payment_succeeded", providerRef: "cs_1", eventId: "e1", gameId: "g1", eventPlayerId: "ep1", amountCents: 550, currency: "EUR" });
  });

  it("maps an expired session to payment_failed", async () => {
    const body = JSON.stringify({ id: "evt_2", type: "checkout.session.expired", data: { object: { id: "cs_2" } } });
    expect(await provider.parseWebhook(body, sign(body))).toEqual({ kind: "payment_failed", providerRef: "cs_2" });
  });

  it("ignores unrelated events and rejects bad signatures", async () => {
    const body = JSON.stringify({ id: "evt_3", type: "customer.created" });
    expect(await provider.parseWebhook(body, sign(body))).toEqual({ kind: "ignored", providerRef: "evt_3" });
    await expect(provider.parseWebhook(body, "t=1,v1=deadbeef")).rejects.toThrow(/signature/i);
  });
});

describe("StripeConnectProvider.createCheckout", () => {
  it("posts a destination checkout session and returns the hosted url", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cs_9", url: "https://checkout.stripe.com/cs_9" }),
    });
    const provider = new StripeConnectProvider(KEY, SECRET, fetchImpl as unknown as typeof fetch);

    const session = await provider.createCheckout({
      eventId: "e1",
      gameId: "g1",
      eventPlayerId: "ep1",
      amountCents: 550,
      currency: "EUR",
      description: "Game share",
      successUrl: "https://app/s",
      cancelUrl: "https://app/c",
      destinationAccountId: "acct_1",
    });

    expect(session).toEqual({ provider: "stripe", url: "https://checkout.stripe.com/cs_9", providerRef: "cs_9" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    const body = init.body as string;
    expect(body).toContain("metadata%5BeventId%5D=e1");
    expect(body).toContain("payment_intent_data%5Btransfer_data%5D%5Bdestination%5D=acct_1");
    expect(body).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=550");
  });
});
