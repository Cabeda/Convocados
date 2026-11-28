/**
 * Regression for #1730: push bodies whose translation already states the
 * roster count must not have the capacity suffix appended a second time.
 *
 * few_spots_left, game_full and player_left each render the count (or the
 * "game is full" fact) themselves, so the composed body must equal the base
 * translation on both the FCM and web-push senders, in every locale.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { generateKeyPairSync } from "crypto";
import { prisma } from "~/lib/db.server";
import { createT, translations, type Locale } from "~/lib/i18n";
import type { NotificationJobType } from "~/lib/notificationQueue.server";

// ── Mock fetch (FCM OAuth token + message send) ──────────────────────────────
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

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: "test-project",
  client_email: "test@test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
});

// ── Mock web-push ─────────────────────────────────────────────────────────────
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

import { sendPushToEvent, capacitySuffix } from "~/lib/push.server";

const LOCALES = Object.keys(translations) as Locale[];
const EVENT_ID = "evt-capacity-self";
const EVENT_TITLE = "Wednesday Football";

interface Scenario {
  jobType: NotificationJobType;
  key: Parameters<ReturnType<typeof createT>>[0];
  params: Record<string, string>;
  spotsLeft: number;
}

const SELF_SUFFICIENT: Scenario[] = [
  {
    jobType: "few_spots_left",
    key: "notifyFewSpotsLeft",
    params: { title: EVENT_TITLE, n: "2" },
    spotsLeft: 2,
  },
  {
    jobType: "game_full",
    key: "notifyGameFullAlert",
    params: { name: "Ana" },
    spotsLeft: 0,
  },
  {
    jobType: "player_left",
    key: "notifyPlayerLeft",
    params: { name: "Ana", n: "3" },
    spotsLeft: 3,
  },
];

async function seedLocaleRecipients() {
  const owner = await prisma.user.create({
    data: { id: "cap-self-owner", name: "Owner", email: "owner@test.com", emailVerified: true },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: EVENT_TITLE,
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
      maxPlayers: 10,
      ownerId: owner.id,
    },
  });

  for (const [order, locale] of LOCALES.entries()) {
    const user = await prisma.user.create({
      data: { id: `cap-self-${locale}`, name: locale, email: `${locale}@test.com`, emailVerified: true },
    });
    await prisma.eventFollow.create({ data: { eventId: EVENT_ID, userId: user.id } });
    await prisma.player.create({ data: { eventId: EVENT_ID, userId: user.id, name: locale, order } });
    await prisma.appPushToken.create({
      data: { userId: user.id, token: `fcm-cap-self-${locale}`, platform: "android", locale },
    });
    await prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: `https://cap-self-${locale}.endpoint`,
        p256dh: "a",
        auth: "b",
        locale,
      },
    });
  }
}

function fcmBodiesByLocale(): Record<string, string> {
  const bodies: Record<string, string> = {};
  for (const call of mockFetch.mock.calls) {
    if (typeof call[0] !== "string" || !call[0].includes("fcm.googleapis.com")) continue;
    const message = JSON.parse(call[1].body).message;
    const locale = message.token.replace("fcm-cap-self-", "");
    bodies[locale] = message.data.body;
  }
  return bodies;
}

function webBodiesByLocale(): Record<string, string> {
  const bodies: Record<string, string> = {};
  for (const call of mockSendNotification.mock.calls) {
    const endpoint = (call[0] as { endpoint: string }).endpoint;
    const locale = endpoint.replace("https://cap-self-", "").replace(".endpoint", "");
    bodies[locale] = JSON.parse(call[1] as string).body;
  }
  return bodies;
}

beforeEach(async () => {
  process.env.VAPID_PUBLIC_KEY = "test-public";
  process.env.VAPID_PRIVATE_KEY = "test-private";
  mockFetch.mockClear();
  mockSendNotification.mockClear();
  await prisma.notificationPreferences.deleteMany();
  await prisma.notificationJob.deleteMany();
  await prisma.appPushToken.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await seedLocaleRecipients();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("capacity suffix is not appended to bodies that already state it (#1730)", () => {
  for (const scenario of SELF_SUFFICIENT) {
    it(`sends the base ${scenario.jobType} body on FCM and web push in all six locales`, async () => {
      await sendPushToEvent(
        EVENT_ID,
        "Push Test Game",
        scenario.key,
        scenario.params,
        `/events/${EVENT_ID}`,
        scenario.spotsLeft,
        undefined,
        scenario.jobType,
      );

      const fcm = fcmBodiesByLocale();
      const web = webBodiesByLocale();
      const englishBody = createT("en")(scenario.key, scenario.params);

      for (const locale of LOCALES) {
        const expected = createT(locale)(scenario.key, scenario.params);
        expect(fcm[locale], `FCM ${locale}`).toBe(expected);
        expect(web[locale], `web push ${locale}`).toBe(expected);
        expect(fcm[locale], `FCM ${locale} must not append a suffix`).not.toContain(" · ");
        expect(web[locale], `web push ${locale} must not append a suffix`).not.toContain(" · ");
        if (locale !== "en") {
          expect(expected, `${locale} base translation must be localized`).not.toBe(englishBody);
          expect(fcm[locale], `FCM ${locale} must not fall back to English`).not.toBe(englishBody);
          expect(web[locale], `web push ${locale} must not fall back to English`).not.toBe(englishBody);
        }
      }
    });
  }

  it("keeps the suffix for recruitment, spot_available and reminder", () => {
    const t = createT("en");
    const spotsLeft = t("notifySpotsLeft", { n: 2 });
    const gameFull = t("notifyGameFull");

    expect(capacitySuffix("recruitment", 2, t)).toBe(spotsLeft);
    expect(capacitySuffix("spot_available", 0, t)).toBe(gameFull);
    expect(capacitySuffix("reminder", 0, t)).toBe(gameFull);
    expect(capacitySuffix("player_joined", 0, t)).toBe(gameFull);
  });
});
