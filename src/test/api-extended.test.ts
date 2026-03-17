import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";

// Import route handlers
import { GET as getHealth } from "~/pages/api/health";
import { PUT as updateBalanced } from "~/pages/api/events/[id]/balanced";
import { PUT as updateVisibility } from "~/pages/api/events/[id]/visibility";
import { PUT as updateLocation } from "~/pages/api/events/[id]/location";
import { PUT as updateTitle } from "~/pages/api/events/[id]/title";
import { POST as claimOwnership, DELETE as relinquishOwnership } from "~/pages/api/events/[id]/claim";
import { POST as transferOwnership } from "~/pages/api/events/[id]/transfer";
import { GET as getStatus } from "~/pages/api/events/[id]/status";
import { POST as subscribePush, DELETE as unsubscribePush } from "~/pages/api/events/[id]/push";
import { GET as getHistory } from "~/pages/api/events/[id]/history/index";
import { PATCH as patchHistory } from "~/pages/api/events/[id]/history/[historyId]";
import { GET as getRatings } from "~/pages/api/events/[id]/ratings/index";
import { POST as recalculateRatings } from "~/pages/api/events/[id]/ratings/recalculate";
import { GET as getVapidKey } from "~/pages/api/push/vapid-public-key";
import { GET as getUserProfile, PATCH as patchUserProfile } from "~/pages/api/users/[id]";
import { GET as getMyGames } from "~/pages/api/me/games";

// ── Helpers ──────────────────────────────────────────────────────────────────

function ctx(params: Record<string, string>, body?: unknown, method = "GET") {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? (method === "GET" ? "POST" : method) : method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

function putCtx(params: Record<string, string>, body: unknown) {
  return ctx(params, body, "PUT");
}

function patchCtx(params: Record<string, string>, body: unknown) {
  return ctx(params, body, "PATCH");
}

function deleteCtx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  const event = await prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ...overrides,
    },
  });
  return event.id;
}

async function seedUser(overrides: Record<string, unknown> = {}) {
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      id,
      name: "Test User",
      email: `${id}@test.com`,
      emailVerified: false,
      ...overrides,
    },
  });
  return user;
}

async function seedHistory(eventId: string, overrides: Record<string, unknown> = {}) {
  return prisma.gameHistory.create({
    data: {
      eventId,
      dateTime: new Date(),
      status: "played",
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      editableUntil: new Date(Date.now() + 86400_000),
      ...overrides,
    },
  });
}

beforeEach(async () => {
  await prisma.pushSubscription.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ─── GET /api/health ─────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns ok status", async () => {
    const res = await getHealth(ctx({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

// ─── PUT /api/events/[id]/balanced ───────────────────────────────────────────

describe("PUT /api/events/[id]/balanced", () => {
  it("toggles balanced mode", async () => {
    const id = await seedEvent();
    const res = await updateBalanced(putCtx({ id }, { balanced: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balanced).toBe(true);
  });

  it("returns 404 for unknown event", async () => {
    const res = await updateBalanced(putCtx({ id: "nonexistent" }, { balanced: true }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when event has owner and request is not from owner", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id });
    const res = await updateBalanced(putCtx({ id }, { balanced: true }));
    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/events/[id]/visibility ─────────────────────────────────────────

describe("PUT /api/events/[id]/visibility", () => {
  it("toggles public visibility", async () => {
    const id = await seedEvent();
    const res = await updateVisibility(putCtx({ id }, { isPublic: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isPublic).toBe(true);
  });

  it("returns 404 for unknown event", async () => {
    const res = await updateVisibility(putCtx({ id: "nonexistent" }, { isPublic: true }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when event has owner and request is not from owner", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id });
    const res = await updateVisibility(putCtx({ id }, { isPublic: true }));
    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/events/[id]/location ───────────────────────────────────────────

describe("PUT /api/events/[id]/location", () => {
  it("updates location", async () => {
    const id = await seedEvent();
    const res = await updateLocation(putCtx({ id }, { location: "New Pitch" }));
    expect(res.status).toBe(200);
  });

  it("returns 404 for unknown event", async () => {
    const res = await updateLocation(putCtx({ id: "nonexistent" }, { location: "X" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when event has owner and request is not from owner", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id });
    const res = await updateLocation(putCtx({ id }, { location: "X" }));
    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/events/[id]/title ──────────────────────────────────────────────

describe("PUT /api/events/[id]/title", () => {
  it("updates title", async () => {
    const id = await seedEvent();
    const res = await updateTitle(putCtx({ id }, { title: "New Title" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("New Title");
  });

  it("returns 404 for unknown event", async () => {
    const res = await updateTitle(putCtx({ id: "nonexistent" }, { title: "X" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for empty title", async () => {
    const id = await seedEvent();
    const res = await updateTitle(putCtx({ id }, { title: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when event has owner and request is not from owner", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id });
    const res = await updateTitle(putCtx({ id }, { title: "X" }));
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/events/[id]/claim ─────────────────────────────────────────────

describe("POST /api/events/[id]/claim", () => {
  it("returns 401 for unauthenticated user", async () => {
    const id = await seedEvent();
    const res = await claimOwnership(ctx({ id }, {}));
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/events/[id]/claim ───────────────────────────────────────────

describe("DELETE /api/events/[id]/claim", () => {
  it("returns 401 for unauthenticated user", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id });
    const res = await relinquishOwnership(deleteCtx({ id }));
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/events/[id]/transfer ──────────────────────────────────────────

describe("POST /api/events/[id]/transfer", () => {
  it("returns 404 for unknown event", async () => {
    const res = await transferOwnership(ctx({ id: "nonexistent" }, { targetUserId: "x" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id });
    const res = await transferOwnership(ctx({ id }, { targetUserId: "x" }));
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/events/[id]/status ─────────────────────────────────────────────

describe("GET /api/events/[id]/status", () => {
  it("returns event status with player breakdown", async () => {
    const id = await seedEvent({ maxPlayers: 2 });
    await prisma.player.createMany({
      data: [
        { name: "Alice", eventId: id },
        { name: "Bob", eventId: id },
        { name: "Charlie", eventId: id },
      ],
    });
    const res = await getStatus(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.players.active).toHaveLength(2);
    expect(body.players.bench).toHaveLength(1);
    expect(body.players.total).toBe(3);
    expect(body.players.spotsLeft).toBe(0);
  });

  it("returns 404 for unknown event", async () => {
    const res = await getStatus(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });
});

// ─── POST/DELETE /api/events/[id]/push ───────────────────────────────────────

describe("POST /api/events/[id]/push", () => {
  it("subscribes to push notifications", async () => {
    const id = await seedEvent();
    const res = await subscribePush(ctx({ id }, {
      endpoint: "https://push.example.com/sub1",
      keys: { p256dh: "key1", auth: "auth1" },
      locale: "en",
      clientId: "client1",
    }));
    expect(res.status).toBe(200);
    const subs = await prisma.pushSubscription.findMany({ where: { eventId: id } });
    expect(subs).toHaveLength(1);
    expect(subs[0].endpoint).toBe("https://push.example.com/sub1");
  });

  it("returns 404 for unknown event", async () => {
    const res = await subscribePush(ctx({ id: "nonexistent" }, {
      endpoint: "https://push.example.com/sub1",
      keys: { p256dh: "key1", auth: "auth1" },
    }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid subscription", async () => {
    const id = await seedEvent();
    const res = await subscribePush(ctx({ id }, { endpoint: "", keys: {} }));
    expect(res.status).toBe(400);
  });

  it("handles pt locale", async () => {
    const id = await seedEvent();
    await subscribePush(ctx({ id }, {
      endpoint: "https://push.example.com/sub-pt",
      keys: { p256dh: "k", auth: "a" },
      locale: "pt-BR",
    }));
    const sub = await prisma.pushSubscription.findFirst({ where: { eventId: id } });
    expect(sub?.locale).toBe("pt");
  });

  it("upserts existing subscription", async () => {
    const id = await seedEvent();
    const payload = {
      endpoint: "https://push.example.com/sub-upsert",
      keys: { p256dh: "k1", auth: "a1" },
    };
    await subscribePush(ctx({ id }, payload));
    await subscribePush(ctx({ id }, { ...payload, keys: { p256dh: "k2", auth: "a2" } }));
    const subs = await prisma.pushSubscription.findMany({ where: { eventId: id } });
    expect(subs).toHaveLength(1);
    expect(subs[0].p256dh).toBe("k2");
  });
});

describe("DELETE /api/events/[id]/push", () => {
  it("unsubscribes from push notifications", async () => {
    const id = await seedEvent();
    await prisma.pushSubscription.create({
      data: { eventId: id, endpoint: "https://push.example.com/del", p256dh: "k", auth: "a", locale: "en", clientId: "" },
    });
    const res = await unsubscribePush(deleteCtx({ id }, { endpoint: "https://push.example.com/del" }));
    expect(res.status).toBe(200);
    const subs = await prisma.pushSubscription.findMany({ where: { eventId: id } });
    expect(subs).toHaveLength(0);
  });

  it("returns 400 for missing endpoint", async () => {
    const id = await seedEvent();
    const res = await unsubscribePush(deleteCtx({ id }, {}));
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/events/[id]/history ────────────────────────────────────────────

describe("GET /api/events/[id]/history", () => {
  it("returns history entries", async () => {
    const id = await seedEvent();
    await seedHistory(id, {
      scoreOne: 3,
      scoreTwo: 2,
      teamsSnapshot: JSON.stringify([
        { team: "A", players: [{ name: "Alice", order: 0 }] },
        { team: "B", players: [{ name: "Bob", order: 0 }] },
      ]),
    });
    const res = await getHistory(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].editable).toBe(true);
  });

  it("returns 404 for unknown event", async () => {
    const res = await getHistory(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("handles cancelled games in history", async () => {
    const id = await seedEvent();
    await seedHistory(id, {
      status: "cancelled",
      editableUntil: new Date(Date.now() - 1000),
    });
    const res = await getHistory(ctx({ id }));
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].editable).toBe(false);
  });
});

// ─── PATCH /api/events/[id]/history/[historyId] ──────────────────────────────

describe("PATCH /api/events/[id]/history/[historyId]", () => {
  it("updates a history entry", async () => {
    const id = await seedEvent();
    const history = await seedHistory(id);
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 3, scoreTwo: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoreOne).toBe(3);
    expect(body.scoreTwo).toBe(1);
  });

  it("returns 404 for unknown event", async () => {
    const res = await patchHistory(patchCtx({ id: "nonexistent", historyId: "x" }, { scoreOne: 1 }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown history entry", async () => {
    const id = await seedEvent();
    const res = await patchHistory(patchCtx({ id, historyId: "nonexistent" }, { scoreOne: 1 }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when entry is no longer editable", async () => {
    const id = await seedEvent();
    const history = await seedHistory(id, { editableUntil: new Date(Date.now() - 1000) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 3 }));
    expect(res.status).toBe(403);
  });

  it("triggers ELO processing when scores are set", async () => {
    const id = await seedEvent();
    const teams = [
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const history = await seedHistory(id, { teamsSnapshot: JSON.stringify(teams) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 2, scoreTwo: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eloUpdates).toBeTruthy();
    expect(body.eloUpdates.length).toBe(2);
    const updated = await prisma.gameHistory.findUnique({ where: { id: history.id } });
    expect(updated?.eloProcessed).toBe(true);
  });

  it("returns 403 when event has owner and request is not from owner", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id });
    const history = await seedHistory(id);
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 1 }));
    expect(res.status).toBe(403);
  });

  it("handles status change to cancelled", async () => {
    const id = await seedEvent();
    const history = await seedHistory(id);
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { status: "cancelled" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("cancelled");
  });
});

// ─── GET /api/events/[id]/ratings ────────────────────────────────────────────

describe("GET /api/events/[id]/ratings", () => {
  it("returns ratings for event", async () => {
    const id = await seedEvent();
    await prisma.playerRating.create({
      data: { eventId: id, name: "Alice", rating: 1050, gamesPlayed: 5, wins: 3, draws: 1, losses: 1 },
    });
    const res = await getRatings(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Alice");
    expect(body[0].rating).toBe(1050);
  });

  it("returns 404 for unknown event", async () => {
    const res = await getRatings(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/events/[id]/ratings/recalculate ───────────────────────────────

describe("POST /api/events/[id]/ratings/recalculate", () => {
  it("recalculates ratings from history", async () => {
    const id = await seedEvent();
    const teams = [
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    await seedHistory(id, {
      scoreOne: 3,
      scoreTwo: 1,
      teamsSnapshot: JSON.stringify(teams),
    });
    const res = await recalculateRatings(ctx({ id }, {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gamesProcessed).toBe(1);
    // Verify ratings were created
    const ratings = await prisma.playerRating.findMany({ where: { eventId: id } });
    expect(ratings).toHaveLength(2);
  });

  it("returns 404 for unknown event", async () => {
    const res = await recalculateRatings(ctx({ id: "nonexistent" }, {}));
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/push/vapid-public-key ──────────────────────────────────────────

describe("GET /api/push/vapid-public-key", () => {
  it("returns the VAPID public key", async () => {
    const res = await getVapidKey(ctx({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("publicKey");
  });
});

// ─── GET /api/users/[id] ────────────────────────────────────────────────────

describe("GET /api/users/[id]", () => {
  it("returns user profile with games", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id, isPublic: true });
    const res = await getUserProfile(ctx({ id: user.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.name).toBe("Test User");
    expect(body.owned).toHaveLength(1);
    expect(body.stats.ownedGames).toBe(1);
    expect(body.isOwnProfile).toBe(false);
    // Email should not be visible to anonymous
    expect(body.user.email).toBeUndefined();
  });

  it("returns 404 for unknown user", async () => {
    const res = await getUserProfile(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("filters out private events for anonymous viewers", async () => {
    const user = await seedUser();
    await seedEvent({ ownerId: user.id, isPublic: false });
    await seedEvent({ ownerId: user.id, isPublic: true });
    const res = await getUserProfile(ctx({ id: user.id }));
    const body = await res.json();
    // Only public event visible
    expect(body.owned).toHaveLength(1);
    expect(body.stats.ownedGames).toBe(1);
  });

  it("includes joined events", async () => {
    const user = await seedUser();
    const eventId = await seedEvent({ isPublic: true });
    await prisma.player.create({ data: { name: user.name, eventId, userId: user.id } });
    const res = await getUserProfile(ctx({ id: user.id }));
    const body = await res.json();
    expect(body.joined).toHaveLength(1);
  });
});

// ─── PATCH /api/users/[id] ──────────────────────────────────────────────────

describe("PATCH /api/users/[id]", () => {
  it("returns 403 for unauthenticated user", async () => {
    const user = await seedUser();
    const res = await patchUserProfile(patchCtx({ id: user.id }, { name: "New Name" }));
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/me/games ──────────────────────────────────────────────────────

describe("GET /api/me/games", () => {
  it("returns 401 for unauthenticated user", async () => {
    const res = await getMyGames(ctx({}));
    expect(res.status).toBe(401);
  });
});
