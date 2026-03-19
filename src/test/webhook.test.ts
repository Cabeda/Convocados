import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { prisma } from "~/lib/db.server";

import { POST as createWebhook, GET as listWebhooks } from "~/pages/api/events/[id]/webhooks/index";
import { DELETE as deleteWebhook } from "~/pages/api/events/[id]/webhooks/[webhookId]/index";
import { signPayload, fireWebhooks } from "~/lib/webhook.server";

// Helpers
function ctx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

function deleteCtx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });
  return { request, params } as any;
}

async function seedEvent() {
  const event = await prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
    },
  });
  return event.id;
}

beforeEach(async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

// ─── POST /api/events/[id]/webhooks ─────────────────────────────────────────

describe("POST /api/events/[id]/webhooks", () => {
  it("creates a webhook subscription", async () => {
    const id = await seedEvent();
    const res = await createWebhook(ctx({ id }, {
      url: "https://example.com/hook",
      events: ["player_joined"],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.url).toBe("https://example.com/hook");
    expect(body.events).toEqual(["player_joined"]);
  });

  it("returns 404 for unknown event", async () => {
    const res = await createWebhook(ctx({ id: "bad-id" }, {
      url: "https://example.com/hook",
    }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when url is missing", async () => {
    const id = await seedEvent();
    const res = await createWebhook(ctx({ id }, {}));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid URL", async () => {
    const id = await seedEvent();
    const res = await createWebhook(ctx({ id }, { url: "not-a-url" }));
    expect(res.status).toBe(400);
  });

  it("returns 409 for duplicate URL on same event", async () => {
    const id = await seedEvent();
    await createWebhook(ctx({ id }, { url: "https://example.com/hook" }));
    const res = await createWebhook(ctx({ id }, { url: "https://example.com/hook" }));
    expect(res.status).toBe(409);
  });

  it("filters invalid event types", async () => {
    const id = await seedEvent();
    const res = await createWebhook(ctx({ id }, {
      url: "https://example.com/hook",
      events: ["player_joined", "invalid_event", "game_full"],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual(["player_joined", "game_full"]);
  });

  it("defaults to empty events array (subscribe to all)", async () => {
    const id = await seedEvent();
    const res = await createWebhook(ctx({ id }, {
      url: "https://example.com/hook",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
  });

  it("returns 429 when max webhooks reached", async () => {
    const id = await seedEvent();
    for (let i = 0; i < 10; i++) {
      await createWebhook(ctx({ id }, { url: `https://example.com/hook${i}` }));
    }
    const res = await createWebhook(ctx({ id }, { url: "https://example.com/hook10" }));
    expect(res.status).toBe(429);
  });
});

// ─── GET /api/events/[id]/webhooks ──────────────────────────────────────────

describe("GET /api/events/[id]/webhooks", () => {
  it("lists webhooks for an event", async () => {
    const id = await seedEvent();
    await createWebhook(ctx({ id }, { url: "https://example.com/hook1" }));
    await createWebhook(ctx({ id }, { url: "https://example.com/hook2" }));

    const res = await listWebhooks(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhooks).toHaveLength(2);
  });

  it("returns 404 for unknown event", async () => {
    const res = await listWebhooks(ctx({ id: "bad-id" }));
    expect(res.status).toBe(404);
  });

  it("returns empty array when no webhooks", async () => {
    const id = await seedEvent();
    const res = await listWebhooks(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhooks).toEqual([]);
  });
});

// ─── DELETE /api/events/[id]/webhooks/[webhookId] ───────────────────────────

describe("DELETE /api/events/[id]/webhooks/[webhookId]", () => {
  it("deletes a webhook subscription", async () => {
    const id = await seedEvent();
    const createRes = await createWebhook(ctx({ id }, { url: "https://example.com/hook" }));
    const { id: webhookId } = await createRes.json();

    const res = await deleteWebhook(deleteCtx({ id, webhookId }));
    expect(res.status).toBe(200);

    const listRes = await listWebhooks(ctx({ id }));
    const body = await listRes.json();
    expect(body.webhooks).toHaveLength(0);
  });

  it("returns 404 for unknown webhook", async () => {
    const id = await seedEvent();
    const res = await deleteWebhook(deleteCtx({ id, webhookId: "bad-id" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when webhook belongs to different event", async () => {
    const id1 = await seedEvent();
    const id2 = await seedEvent();
    const createRes = await createWebhook(ctx({ id: id1 }, { url: "https://example.com/hook" }));
    const { id: webhookId } = await createRes.json();

    const res = await deleteWebhook(deleteCtx({ id: id2, webhookId }));
    expect(res.status).toBe(404);
  });
});

// ─── signPayload ────────────────────────────────────────────────────────────

describe("signPayload", () => {
  it("produces a deterministic HMAC-SHA256 signature", () => {
    const sig = signPayload('{"test":true}', "my-secret");
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    // Same input = same output
    expect(signPayload('{"test":true}', "my-secret")).toBe(sig);
  });

  it("produces different signatures for different secrets", () => {
    const sig1 = signPayload('{"test":true}', "secret-a");
    const sig2 = signPayload('{"test":true}', "secret-b");
    expect(sig1).not.toBe(sig2);
  });
});

// ─── fireWebhooks ───────────────────────────────────────────────────────────

describe("fireWebhooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("delivers to matching webhook and records success", async () => {
    const id = await seedEvent();
    await prisma.webhookSubscription.create({
      data: {
        eventId: id,
        url: "https://httpbin.org/post",
        events: JSON.stringify(["player_joined"]),
      },
    });

    // Mock fetch to avoid real HTTP calls
    const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await fireWebhooks(id, "player_joined", { playerName: "Alice", spotsLeft: 3 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://httpbin.org/post");
    expect(opts.method).toBe("POST");

    const payload = JSON.parse(opts.body);
    expect(payload.event).toBe("player_joined");
    expect(payload.data.playerName).toBe("Alice");

    // Check delivery was recorded
    const deliveries = await prisma.webhookDelivery.findMany();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("success");
  });

  it("skips webhooks not subscribed to the event type", async () => {
    const id = await seedEvent();
    await prisma.webhookSubscription.create({
      data: {
        eventId: id,
        url: "https://httpbin.org/post",
        events: JSON.stringify(["game_full"]),
      },
    });

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await fireWebhooks(id, "player_joined", { playerName: "Alice" });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("delivers to webhooks with empty events array (subscribe to all)", async () => {
    const id = await seedEvent();
    await prisma.webhookSubscription.create({
      data: {
        eventId: id,
        url: "https://httpbin.org/post",
        events: JSON.stringify([]),
      },
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await fireWebhooks(id, "player_left", { playerName: "Bob" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("includes HMAC signature when secret is configured", async () => {
    const id = await seedEvent();
    await prisma.webhookSubscription.create({
      data: {
        eventId: id,
        url: "https://httpbin.org/post",
        secret: "test-secret",
        events: JSON.stringify([]),
      },
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await fireWebhooks(id, "player_joined", { playerName: "Alice" });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-Webhook-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("records failed delivery after all retries exhausted", async () => {
    const id = await seedEvent();
    await prisma.webhookSubscription.create({
      data: {
        eventId: id,
        url: "https://httpbin.org/status/500",
        events: JSON.stringify([]),
      },
    });

    // Mock fetch to always fail
    const mockFetch = vi.fn().mockResolvedValue(new Response("Error", { status: 500 }));
    vi.stubGlobal("fetch", mockFetch);

    await fireWebhooks(id, "player_joined", { playerName: "Alice" });

    expect(mockFetch).toHaveBeenCalledTimes(5); // MAX_ATTEMPTS
    const deliveries = await prisma.webhookDelivery.findMany();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("failed");
    expect(deliveries[0].attempts).toBe(5);
  }, 60000);

  it("does nothing when no webhooks are registered", async () => {
    const id = await seedEvent();
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await fireWebhooks(id, "player_joined", { playerName: "Alice" });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("records network errors and retries", async () => {
    const id = await seedEvent();
    await prisma.webhookSubscription.create({
      data: {
        eventId: id,
        url: "https://unreachable.invalid/hook",
        events: JSON.stringify([]),
      },
    });

    const mockFetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", mockFetch);

    await fireWebhooks(id, "player_joined", { playerName: "Alice" });

    expect(mockFetch).toHaveBeenCalledTimes(5);
    const deliveries = await prisma.webhookDelivery.findMany();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("failed");
    expect(deliveries[0].error).toBe("fetch failed");
  }, 60000);

  it("records AbortError as Timeout", async () => {
    const id = await seedEvent();
    await prisma.webhookSubscription.create({
      data: {
        eventId: id,
        url: "https://slow.invalid/hook",
        events: JSON.stringify([]),
      },
    });

    const abortErr = new DOMException("The operation was aborted", "AbortError");
    const mockFetch = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal("fetch", mockFetch);

    await fireWebhooks(id, "player_joined", { playerName: "Alice" });

    const deliveries = await prisma.webhookDelivery.findMany();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].error).toBe("Timeout");
  }, 60000);
});
