/**
 * ADR 0051: occurrence-scoped webhook facts must carry the occurrence they
 * describe. A subscriber keys dedupe on (eventId, gameId); without a gameId a
 * recurring event collapses every occurrence into one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { fireWebhooks } from "~/lib/webhook.server";

// The occurrence-scoped half of WEBHOOK_EVENT_TYPES. Kept local until the
// contract lives in webhookEvents.ts beside the list it classifies.
const OCCURRENCE_SCOPED_EVENT_TYPES = [
  "player_joined",
  "player_left",
  "game_full",
  "game_reset",
  "game_cancelled",
  "game_payer_set",
  "reminder",
  "rsvp_request",
  "rsvp_summary",
  "recruitment",
  "payment_nudge",
  "payment_organizer_alert",
  "payer_check_in",
] as const;

async function seedEventWithGame() {
  const event = await prisma.event.create({
    data: {
      title: "Occurrence Contract",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime },
  });
  await prisma.event.update({
    where: { id: event.id },
    data: { currentGameId: game.id },
  });
  return { event, game };
}

beforeEach(async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("occurrence-scoped webhook payload contract", () => {
  it("emits gameId and dateTime for every occurrence-scoped event type", async () => {
    vi.stubEnv("WEBHOOK_BACKOFF_BASE_MS", "1");
    const { event, game } = await seedEventWithGame();
    await prisma.webhookSubscription.create({
      data: {
        eventId: event.id,
        url: "https://example.com/hook",
        events: JSON.stringify([]),
      },
    });
    const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const missing: string[] = [];
    for (const type of OCCURRENCE_SCOPED_EVENT_TYPES) {
      mockFetch.mockClear();
      await fireWebhooks(event.id, type, {});
      const [, opts] = mockFetch.mock.calls[0];
      const payload = JSON.parse(opts.body);
      if (payload.data.gameId !== game.id) {
        missing.push(`${type}: gameId=${String(payload.data.gameId)}`);
      }
      if (payload.data.dateTime !== event.dateTime.toISOString()) {
        missing.push(`${type}: dateTime=${String(payload.data.dateTime)}`);
      }
    }

    expect(missing).toEqual([]);
  }, 60_000);
});
