import { createHmac, randomUUID } from "crypto";
import { prisma } from "./db.server";
import { createLogger } from "./logger.server";

const log = createLogger("webhook");

export type WebhookEventType =
  | "player_joined"
  | "player_left"
  | "game_full"
  | "game_reset";

const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 5000;
const BACKOFF_BASE_MS = 1000;

export function signPayload(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

interface WebhookPayloadData {
  playerName?: string;
  isActive?: boolean;
  spotsLeft?: number;
  [key: string]: unknown;
}

export async function fireWebhooks(
  eventId: string,
  eventType: WebhookEventType,
  data: WebhookPayloadData,
) {
  const subs = await prisma.webhookSubscription.findMany({
    where: { eventId },
  });

  const matching = subs.filter((sub) => {
    if (sub.disabled) return false;
    const subscribedEvents: string[] = JSON.parse(sub.events);
    return subscribedEvents.length === 0 || subscribedEvents.includes(eventType);
  });

  if (matching.length === 0) return;

  const deliveryId = randomUUID();
  const payload = JSON.stringify({
    event: eventType,
    eventId,
    deliveryId,
    timestamp: new Date().toISOString(),
    data,
  });

  await Promise.allSettled(
    matching.map((sub) => deliverWebhook(sub.id, sub.url, sub.secret, eventType, payload)),
  );
}

async function deliverWebhook(
  webhookId: string,
  url: string,
  secret: string | null,
  eventType: string,
  payload: string,
) {
  const delivery = await prisma.webhookDelivery.create({
    data: { webhookId, eventType, payload, status: "pending" },
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "Convocados-Webhook/1.0",
      };
      if (secret) {
        headers["X-Webhook-Signature"] = signPayload(payload, secret);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: attempt,
          lastAttempt: new Date(),
        },
      });

      if (res.ok) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "success", deliveredAt: new Date() },
        });
        log.info({ url: url.slice(0, 60), attempt }, "Webhook delivered");
        return;
      }

      const errText = `HTTP ${res.status}`;
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { error: errText },
      });
      log.warn({ url: url.slice(0, 60), status: res.status, attempt }, "Webhook delivery failed with HTTP error");
    } catch (err: any) {
      const errMsg = err?.name === "AbortError" ? "Timeout" : (err?.message ?? "Unknown error");
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: attempt,
          lastAttempt: new Date(),
          error: errMsg,
        },
      });
      log.warn({ url: url.slice(0, 60), error: errMsg, attempt }, "Webhook delivery failed");
    }

    // Exponential backoff before retry
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * Math.pow(2, attempt - 1)));
    }
  }

  // All attempts exhausted
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: "failed" },
  });
  log.error({ url: url.slice(0, 60), maxAttempts: MAX_ATTEMPTS }, "Webhook delivery exhausted all attempts");

  // Check health after failure
  await checkWebhookHealth(webhookId);
}

const CONSECUTIVE_FAILURES_THRESHOLD = 10;

/**
 * Auto-disable a webhook after N consecutive failed deliveries.
 */
export async function checkWebhookHealth(webhookId: string): Promise<void> {
  const recentDeliveries = await prisma.webhookDelivery.findMany({
    where: { webhookId },
    orderBy: { createdAt: "desc" },
    take: CONSECUTIVE_FAILURES_THRESHOLD,
    select: { status: true },
  });

  if (recentDeliveries.length < CONSECUTIVE_FAILURES_THRESHOLD) return;

  const allFailed = recentDeliveries.every((d) => d.status === "failed");
  if (allFailed) {
    await prisma.webhookSubscription.update({
      where: { id: webhookId },
      data: { disabled: true },
    });
    log.warn({ webhookId, threshold: CONSECUTIVE_FAILURES_THRESHOLD }, "Auto-disabled webhook after consecutive failures");
  }
}
