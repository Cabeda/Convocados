/**
 * A webhook URL that passes validateWebhookUrl may answer with a 3xx pointing at
 * a private/loopback host. Both server-side senders must refuse to follow it, or
 * a public URL becomes a blind-SSRF status oracle against the production
 * network. See Issue #1748.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const PUBLIC_URL = "https://hooks.example.com/convocados";
const INTERNAL_URL = "http://169.254.169.254/latest/meta-data/";

interface FetchCall {
  url: string;
  init: RequestInit;
}

/**
 * Model the browser/undici fetch contract: with the default redirect policy a
 * 3xx is followed by the fetch implementation itself, so the caller only sees
 * the final internal response. `redirect: "manual"` returns the 3xx instead.
 */
function installRedirectFollowingFetch(): FetchCall[] {
  const calls: FetchCall[] = [];
  const mockFetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    if (url === PUBLIC_URL) {
      if (init.redirect === "manual") {
        return new Response(null, { status: 303, headers: { location: INTERNAL_URL } });
      }
      return mockFetch(INTERNAL_URL, init);
    }
    return new Response("metadata", { status: 200 });
  });
  vi.stubGlobal("fetch", mockFetch);
  return calls;
}

async function seedEvent() {
  return (
    await prisma.event.create({
      data: {
        title: "Webhook Redirect Test",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
      },
    })
  ).id;
}

function postCtx(params: Record<string, string>) {
  return {
    request: new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    params,
  } as any;
}

beforeEach(async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.event.deleteMany();
  vi.stubEnv("WEBHOOK_BACKOFF_BASE_MS", "1");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/events/[id]/webhooks/[webhookId]/test redirect handling", () => {
  it("does not follow a 3xx to an internal host and records the 3xx as a failure", async () => {
    const eventId = await seedEvent();
    const webhook = await prisma.webhookSubscription.create({
      data: { eventId, url: PUBLIC_URL, events: "[]" },
    });
    const calls = installRedirectFollowingFetch();

    const { POST } = await import("~/pages/api/events/[id]/webhooks/[webhookId]/test");
    const res = await POST(postCtx({ id: eventId, webhookId: webhook.id }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(PUBLIC_URL);
    expect(calls[0].init.redirect).toBe("manual");
    expect(body.delivery.status).toBe("failed");
    expect(body.delivery.error).toBe("HTTP 303");
  });
});

describe("deliverWebhook redirect handling", () => {
  it("does not follow a 3xx to an internal host and records the delivery as failed", async () => {
    const eventId = await seedEvent();
    await prisma.webhookSubscription.create({
      data: { eventId, url: PUBLIC_URL, events: "[]" },
    });
    const calls = installRedirectFollowingFetch();

    const { fireWebhooks } = await import("~/lib/webhook.server");
    await fireWebhooks(eventId, "player_joined", { playerName: "Alice" });

    expect(calls.every((c) => c.init.redirect === "manual")).toBe(true);
    expect(calls.some((c) => c.url === INTERNAL_URL)).toBe(false);

    const deliveries = await prisma.webhookDelivery.findMany();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("failed");
    expect(deliveries[0].error).toBe("HTTP 303");
  });
});
