import { createHmac, randomUUID } from "crypto";
import { prisma } from "./db.server";

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
        console.log(`[webhook] delivered to ${url.slice(0, 60)} (attempt ${attempt})`);
        return;
      }

      const errText = `HTTP ${res.status}`;
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { error: errText },
      });
      console.warn(`[webhook] ${url.slice(0, 60)} returned ${res.status} (attempt ${attempt})`);
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
      console.warn(`[webhook] failed ${url.slice(0, 60)}: ${errMsg} (attempt ${attempt})`);
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
  console.error(`[webhook] gave up on ${url.slice(0, 60)} after ${MAX_ATTEMPTS} attempts`);
}
