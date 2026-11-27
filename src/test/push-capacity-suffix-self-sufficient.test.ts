/**
 * #1730 — some push bodies already state the roster capacity themselves, so the
 * shared "· N spots left" suffix repeats the same number. These tests pin the
 * exact composed body (not just "contains ·") for those three job types, across
 * all six locales, on both the FCM and web-push senders.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { createT, type Locale, type TranslationKey } from "~/lib/i18n";
import { capacitySuffix } from "~/lib/push.server";

// ── Mock fetch (FCM API + OAuth token exchange) ──────────────────────────────
const mockFetch = vi.fn().mockImplementation(async (url: string) => {
  if (typeof url === "string" && url.includes("oauth2.googleapis.com")) {
    return { ok: true, json: async () => ({ access_token: "mock-fcm-token", expires_in: 3600 }) };
  }
  if (typeof url === "string" && url.includes("fcm.googleapis.com")) {
    return { ok: true, json: async () => ({ name: "projects/test/messages/123" }) };
  }
  return { ok: true, json: async () => ({}) };
});
vi.stubGlobal("fetch", mockFetch);

// A real RSA key so crypto.createSign can sign the FCM JWT.
import { generateKeyPairSync } from "crypto";
const { privateKey: testPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: "test-project",
  client_email: "test@test.iam.gserviceaccount.com",
  private_key: testPrivateKey.export({ type: "pkcs8", format: "pem" }),
});

process.env.VAPID_PUBLIC_KEY = "test-public";
process.env.VAPID_PRIVATE_KEY = "test-private";

const mockSendNotification = vi.fn().mockResolvedValue({});
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mockSendNotification },
  setVapidDetails: vi.fn(),
  sendNotification: mockSendNotification,
}));

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const LOCALES: Locale[] = ["en", "pt", "es", "fr", "de", "it"];
const EVENT_TITLE = "Wednesday Football";

function getFcmCalls() {
  return mockFetch.mock.calls.filter(
    (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("fcm.googleapis.com"),
  );
}

function getFcmBody(token: string): string | undefined {
  const call = getFcmCalls().find((c: unknown[]) => {
    const payload = JSON.parse((c[1] as { body: string }).body);
    return payload.message?.token === token;
  });
  if (!call) return undefined;
  const payload = JSON.parse((call[1] as { body: string }).body);
  return payload.message.data.body as string;
}

function getWebBody(endpoint: string): string | undefined {
  const call = mockSendNotification.mock.calls.find(
    (c) => (c[0] as { endpoint: string }).endpoint === endpoint,
  );
  if (!call) return undefined;
  return (JSON.parse(call[1] as string) as { body: string }).body;
}

async function seedEvent(id: string, userId: string) {
  await prisma.user.create({
    data: { id: userId, name: `User ${userId}`, email: `${userId}@test.com`, emailVerified: true },
  });
  await prisma.event.create({
    data: { id, title: EVENT_TITLE, location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId: userId },
  });
  await prisma.player.create({ data: { eventId: id, name: "Player", userId, order: 0 } });
  await prisma.eventFollow.create({ data: { eventId: id, userId } });
  await prisma.appPushToken.create({
    data: { userId, token: `fcm-${id}`, platform: "android", locale: userId.split("-").at(-1) },
  });
  await prisma.pushSubscription.create({
    data: { userId, endpoint: `https://web-${id}.test`, p256dh: "a", auth: "b", locale: userId.split("-").at(-1) },
  });
}

const SELF_SUFFICIENT_CASES: {
  type: "few_spots_left" | "game_full" | "player_left";
  key: TranslationKey;
  params: Record<string, string>;
  spotsLeft: number;
}[] = [
  { type: "few_spots_left", key: "notifyFewSpotsLeft", params: { title: EVENT_TITLE, n: "2" }, spotsLeft: 2 },
  { type: "game_full", key: "notifyGameFullAlert", params: { name: "Last Player" }, spotsLeft: 0 },
  { type: "player_left", key: "notifyPlayerLeft", params: { name: "Ana", n: "3" }, spotsLeft: 3 },
];

beforeEach(async () => {
  mockFetch.mockClear();
  mockSendNotification.mockClear();
  await prisma.notificationJob.deleteMany();
  await prisma.appPushToken.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("capacity suffix — self-sufficient push bodies (#1730)", () => {
  for (const { type, key, params, spotsLeft } of SELF_SUFFICIENT_CASES) {
    it(`${type}: composed body equals the base translation in all six locales (FCM + web push)`, async () => {
      const { sendPushToEvent } = await import("~/lib/push.server");

      for (const locale of LOCALES) {
        const userId = `user-${type}-${locale}`;
        const eventId = `evt-${type}-${locale}`;
        await seedEvent(eventId, userId);

        await sendPushToEvent(
          eventId,
          EVENT_TITLE,
          key,
          params,
          `/events/${eventId}`,
          spotsLeft,
          undefined,
          type,
        );

        const expected = createT(locale)(key, params);
        expect(getFcmBody(`fcm-${eventId}`), `FCM body for ${locale}`).toBe(expected);
        expect(getWebBody(`https://web-${eventId}.test`), `web-push body for ${locale}`).toBe(expected);
      }
    });
  }

  it("keeps the suffix for types that carry no count of their own", () => {
    const t = createT("en");
    for (const type of ["recruitment", "spot_available", "reminder"] as const) {
      expect(capacitySuffix(type, 2, t)).toBe(t("notifySpotsLeft", { n: 2 }));
      expect(capacitySuffix(type, 0, t)).toBe(t("notifyGameFull"));
    }
  });
});
