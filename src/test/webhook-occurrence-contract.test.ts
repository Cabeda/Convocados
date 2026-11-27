/**
 * ADR 0051: occurrence-scoped webhook facts must carry the occurrence they
 * describe. A subscriber keys dedupe on (eventId, gameId); without a gameId a
 * recurring event collapses every occurrence into one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "~/lib/db.server";
import { fireWebhooks } from "~/lib/webhook.server";
import {
  EVENT_SCOPED_EVENT_TYPES,
  OCCURRENCE_SCOPED_EVENT_TYPES,
  WEBHOOK_EVENT_TYPES,
} from "~/lib/webhookEvents";

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

async function subscribe(eventId: string) {
  await prisma.webhookSubscription.create({
    data: {
      eventId,
      url: "https://example.com/hook",
      events: JSON.stringify([]),
    },
  });
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
  it("classifies every declared event type as occurrence- or event-scoped", () => {
    const classified = [...OCCURRENCE_SCOPED_EVENT_TYPES, ...EVENT_SCOPED_EVENT_TYPES];
    expect([...classified].sort()).toEqual([...WEBHOOK_EVENT_TYPES].sort());

    const overlap = OCCURRENCE_SCOPED_EVENT_TYPES.filter((type) =>
      (EVENT_SCOPED_EVENT_TYPES as readonly string[]).includes(type),
    );
    expect(overlap).toEqual([]);
  });

  it("emits gameId and dateTime for every occurrence-scoped event type", async () => {
    vi.stubEnv("WEBHOOK_BACKOFF_BASE_MS", "1");
    const { event, game } = await seedEventWithGame();
    await subscribe(event.id);
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

  it("keeps an occurrence the emitter names explicitly", async () => {
    vi.stubEnv("WEBHOOK_BACKOFF_BASE_MS", "1");
    const { event } = await seedEventWithGame();
    await subscribe(event.id);
    const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await fireWebhooks(event.id, "game_cancelled", {
      gameId: "cancelled-game",
      dateTime: "2026-01-01T18:00:00.000Z",
    });

    const [, opts] = mockFetch.mock.calls[0];
    const payload = JSON.parse(opts.body);
    expect(payload.data.gameId).toBe("cancelled-game");
    expect(payload.data.dateTime).toBe("2026-01-01T18:00:00.000Z");
  }, 60_000);

  it("documents gameId and dateTime for every occurrence-scoped type", () => {
    const docs = fs.readFileSync(
      path.join(process.cwd(), "src/pages/docs/api/webhooks.astro"),
      "utf8",
    );
    const payloadTable = docs.slice(
      docs.indexOf("<h3>Payload fields by event type</h3>"),
      docs.indexOf("<h2>Signature verification</h2>"),
    );
    const rows = new Map<string, string>();
    for (const match of payloadTable.matchAll(
      /<tr><td><code>([a-z_]+)<\/code><\/td><td>([\s\S]*?)<\/td><\/tr>/g,
    )) {
      rows.set(match[1], match[2]);
    }

    const undocumented = OCCURRENCE_SCOPED_EVENT_TYPES.filter((type) => {
      const fields = rows.get(type) ?? "";
      return !fields.includes("<code>gameId</code>") || !fields.includes("<code>dateTime</code>");
    });
    expect(undocumented).toEqual([]);
  });
});
