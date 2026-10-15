import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

import { POST as randomize } from "~/pages/api/events/[id]/randomize";
import { POST as undoRemove } from "~/pages/api/events/[id]/undo-remove";
import { POST as testWebhook } from "~/pages/api/events/[id]/webhooks/[webhookId]/test";
import { GET as webhookDeliveries } from "~/pages/api/events/[id]/webhooks/[webhookId]/deliveries";
import { POST as calendarToken } from "~/pages/api/me/calendar-token";
import { PUT as settleShare } from "~/pages/api/events/[id]/payments/settlement";
import { PUT as updateTitle } from "~/pages/api/events/[id]/title";
import { PUT as archivePlayer } from "~/pages/api/events/[id]/archive-player";
import { GET as searchCourtAlternatives, PUT as saveCourtWatch } from "~/pages/api/events/[id]/court-alternatives";
import { POST as mergePlayer } from "~/pages/api/events/[id]/merge-player";
import { POST as markNoShow } from "~/pages/api/events/[id]/no-show";
import { DELETE as purgePlayer } from "~/pages/api/events/[id]/purge-player";
import { PUT as reorderPlayers } from "~/pages/api/events/[id]/reorder-players";
import { POST as resetPlayerOrder } from "~/pages/api/events/[id]/reset-player-order";
import { POST as switchCourt } from "~/pages/api/events/[id]/switch-court";
import { PUT as setReminderTimings } from "~/pages/api/events/[id]/reminder-timings";
import { PUT as setNotificationDefaults } from "~/pages/api/events/[id]/notification-defaults";

/**
 * Authorization regressions.
 *
 * Policy: an event mutation requires owner/admin. Ownerless events are openly
 * manageable ONLY while unlisted (the link is the secret — this is the
 * no-account flow). Ownerless PUBLIC events (discoverable Open Pickups) and
 * owned events with a non-owner caller are rejected.
 */

let ownerId = "";
let otherUserId = "";
let ownerToken = "";
let otherToken = "";

async function seedUserWithToken(prefix: string) {
  const userId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.user.create({
    data: { id: userId, name: prefix, email: `${userId}@test.com`, emailVerified: false },
  });
  const clientId = `client-${userId}`;
  await prisma.oauthClient.create({
    data: { id: clientId, clientId, redirectUris: "https://example.com/callback" },
  });
  const token = `tok-${userId}`;
  await prisma.oauthAccessToken.create({
    data: { id: `at-${userId}`, token, clientId, userId, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { userId, token };
}

async function seedEvent(opts: { ownerId?: string | null; isPublic?: boolean; players?: string[] } = {}) {
  const event = await prisma.event.create({
    data: {
      title: "Authz Event",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId: opts.ownerId ?? null,
      isPublic: opts.isPublic ?? false,
    },
  });
  let order = 0;
  for (const name of opts.players ?? []) {
    await prisma.player.create({ data: { name, eventId: event.id, order: order++ } });
  }
  return event;
}

function ctx(params: Record<string, string>, body: unknown, token?: string, method = "POST") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request("http://localhost/api/test", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as any;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  ({ userId: ownerId, token: ownerToken } = await seedUserWithToken("owner"));
  ({ userId: otherUserId, token: otherToken } = await seedUserWithToken("other"));
});

describe("randomize authorization", () => {
  it("rejects an anonymous caller on an owned event", async () => {
    const event = await seedEvent({ ownerId, players: ["Alice", "Bob"] });
    expect((await randomize(ctx({ id: event.id }, {}))).status).toBe(403);
  });

  it("rejects a non-owner on an owned event", async () => {
    const event = await seedEvent({ ownerId, players: ["Alice", "Bob"] });
    expect((await randomize(ctx({ id: event.id }, {}, otherToken))).status).toBe(403);
  });

  it("allows the owner", async () => {
    const event = await seedEvent({ ownerId, players: ["Alice", "Bob"] });
    expect((await randomize(ctx({ id: event.id }, {}, ownerToken))).status).toBe(200);
  });

  it("allows anyone on an ownerless UNLISTED event (no-account flow)", async () => {
    const event = await seedEvent({ ownerId: null, isPublic: false, players: ["Alice", "Bob"] });
    expect((await randomize(ctx({ id: event.id }, {}))).status).toBe(200);
  });

  it("rejects mutations on an ownerless PUBLIC event until adopted", async () => {
    const event = await seedEvent({ ownerId: null, isPublic: true, players: ["Alice", "Bob"] });
    expect((await randomize(ctx({ id: event.id }, {}))).status).toBe(403);
  });
});

describe("undo-remove authorization (was unauthenticated)", () => {
  it("rejects anonymous on an owned event", async () => {
    const event = await seedEvent({ ownerId });
    const res = await undoRemove(ctx({ id: event.id }, { name: "Bob", order: 0, userId: null, removedAt: Date.now() }));
    expect(res.status).toBe(403);
  });

  it("allows the owner", async () => {
    const event = await seedEvent({ ownerId });
    const res = await undoRemove(ctx({ id: event.id }, { name: "Bob", order: 0, userId: null, removedAt: Date.now() }, ownerToken));
    expect(res.status).toBe(200);
  });
});

describe("webhook routes authorization (were unauthenticated)", () => {
  it("rejects anonymous webhook test on an owned event", async () => {
    const event = await seedEvent({ ownerId });
    expect((await testWebhook(ctx({ id: event.id, webhookId: "wh-1" }, undefined))).status).toBe(403);
  });

  it("rejects anonymous delivery log read on an owned event", async () => {
    const event = await seedEvent({ ownerId });
    expect((await webhookDeliveries(ctx({ id: event.id, webhookId: "wh-1" }, undefined, undefined, "GET"))).status).toBe(403);
  });
});

describe("title authorization (ownerless-public guard)", () => {
  it("rejects a title change on an ownerless public event", async () => {
    const event = await seedEvent({ ownerId: null, isPublic: true });
    expect((await updateTitle(ctx({ id: event.id }, { title: "Hacked" }, undefined, "PUT"))).status).toBe(403);
  });

  it("allows the owner", async () => {
    const event = await seedEvent({ ownerId });
    expect((await updateTitle(ctx({ id: event.id }, { title: "Renamed" }, ownerToken, "PUT"))).status).toBe(200);
  });
});

describe("calendar-token event scope authorization (IDOR fix)", () => {
  it("rejects anonymous", async () => {
    const event = await seedEvent({ ownerId });
    expect((await calendarToken(ctx({}, { scope: "event", eventId: event.id }))).status).toBe(401);
  });

  it("rejects an authenticated user who is not part of the event", async () => {
    const event = await seedEvent({ ownerId });
    expect((await calendarToken(ctx({}, { scope: "event", eventId: event.id }, otherToken))).status).toBe(403);
  });

  it("issues a feed token to the owner", async () => {
    const event = await seedEvent({ ownerId });
    expect((await calendarToken(ctx({}, { scope: "event", eventId: event.id }, ownerToken))).status).toBe(200);
  });
});

describe("settlement cross-event guard", () => {
  it("rejects a gameId that belongs to a different event", async () => {
    const eventA = await seedEvent({ ownerId });
    const eventB = await seedEvent({ ownerId: otherUserId });
    const gameB = await prisma.game.create({ data: { eventId: eventB.id, dateTime: new Date(), status: "upcoming" } });
    const res = await settleShare(ctx({ id: eventA.id }, { gameId: gameB.id, eventPlayerId: "x" }, ownerToken, "PUT"));
    expect(res.status).toBe(400);
  });
});

/**
 * Root Event mutation routes must answer the authorization question the shared
 * module answers, rather than re-deriving it (GH-1405). Each call sends an empty
 * body, so `afterGate` is the status the route reaches on its own once
 * authorization is out of the way — a 403 there means the gate is still
 * hand-rolled and the caller never got past it.
 */
const ROOT_EVENT_MUTATIONS = [
  {
    route: "PUT archive-player",
    denied: "Only the event owner or admin can archive players.",
    afterGate: 400,
    call: (id: string, token?: string) => archivePlayer(ctx({ id }, {}, token, "PUT")),
  },
  {
    route: "GET court-alternatives",
    denied: "Only event owner or admins can search alternatives.",
    afterGate: 400,
    call: (id: string, token?: string) => searchCourtAlternatives(ctx({ id }, undefined, token, "GET")),
  },
  {
    route: "PUT court-alternatives",
    denied: "Only event owner or admins can manage court watch.",
    afterGate: 400,
    call: (id: string, token?: string) => saveCourtWatch(ctx({ id }, {}, token, "PUT")),
  },
  {
    route: "POST merge-player",
    denied: "Only the event owner or admin can merge players.",
    afterGate: 400,
    call: (id: string, token?: string) => mergePlayer(ctx({ id }, {}, token, "POST")),
  },
  {
    route: "POST no-show",
    denied: "Only owner/admin can mark no-shows.",
    afterGate: 400,
    call: (id: string, token?: string) => markNoShow(ctx({ id }, {}, token, "POST")),
  },
  {
    route: "DELETE purge-player",
    denied: "Only the event owner or admin can do this.",
    afterGate: 400,
    call: (id: string, token?: string) => purgePlayer(ctx({ id }, {}, token, "DELETE")),
  },
  {
    route: "PUT reorder-players",
    denied: "Only the event owner can reorder players.",
    afterGate: 400,
    call: (id: string, token?: string) => reorderPlayers(ctx({ id }, {}, token, "PUT")),
  },
  {
    route: "POST reset-player-order",
    denied: "Only the event owner can reset player order.",
    afterGate: 200,
    call: (id: string, token?: string) => resetPlayerOrder(ctx({ id }, {}, token, "POST")),
  },
  {
    route: "POST switch-court",
    denied: "Only event owner or admins can switch courts.",
    afterGate: 400,
    call: (id: string, token?: string) => switchCourt(ctx({ id }, {}, token, "POST")),
  },
  {
    route: "PUT reminder-timings",
    denied: "Forbidden",
    afterGate: 400,
    call: (id: string, token?: string) => setReminderTimings(ctx({ id }, {}, token, "PUT")),
  },
  {
    route: "PUT notification-defaults",
    denied: "Forbidden",
    afterGate: 200,
    call: (id: string, token?: string) => setNotificationDefaults(ctx({ id }, {}, token, "PUT")),
  },
];

describe("root Event mutation routes ask one authorization question", () => {
  for (const { route, denied, afterGate, call } of ROOT_EVENT_MUTATIONS) {
    it(`${route} lets an ownerless UNLISTED event through the gate`, async () => {
      const event = await seedEvent({ ownerId: null, isPublic: false });
      expect((await call(event.id)).status).toBe(afterGate);
    });

    it(`${route} still rejects a stranger on an owned event`, async () => {
      const event = await seedEvent({ ownerId });
      const res = await call(event.id, otherToken);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: denied });
    });

    it(`${route} still accepts the owner`, async () => {
      const event = await seedEvent({ ownerId });
      expect((await call(event.id, ownerToken)).status).toBe(afterGate);
    });
  }
});
