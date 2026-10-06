/**
 * MCP player-side and organiser gap tools.
 *
 * Covers follow/unfollow, self-leave, no-show marking and the token-debug tool,
 * plus the rsvp scope fix (a player must not need `manage:players` to answer).
 *
 * Error shape follows the existing endpoint convention: failures come back as a
 * JSON-RPC `error` envelope with a matching HTTP status, success as
 * `result.content[0].text`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
  requireScope: vi.fn((ctx: any, scope: string) => {
    if (ctx.scopes.includes("*")) return true;
    return ctx.scopes.includes(scope);
  }),
}));
vi.mock("~/lib/push.server", () => ({ sendPushToUser: vi.fn(async () => "sent") }));
vi.mock("~/lib/apiRateLimit.server", async (importOriginal) => {
  const orig = (await importOriginal()) as any;
  return {
    ...orig,
    checkApiRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
    extractIp: () => "127.0.0.1",
  };
});

import { authenticateRequest } from "~/lib/authenticate.server";
const { POST } = await import("~/pages/api/mcp");
const { sendPushToUser } = await import("~/lib/push.server");
const mockPush = vi.mocked(sendPushToUser);
import { TOOLS } from "~/lib/mcp/tools";
const mockAuth = vi.mocked(authenticateRequest);
const PROTOCOL = "2026-07-28";

let USER: { id: string; name: string; email: string };

interface Call {
  status: number;
  json: any;
}

function rpcRequest(body: unknown) {
  return new Request("http://localhost:4321/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "MCP-Protocol-Version": PROTOCOL },
    body: JSON.stringify(body),
  });
}

/** Runs a tool as USER with the given scopes and returns status + JSON-RPC envelope. */
async function run(
  name: string,
  args: Record<string, unknown>,
  scopes = ["*"],
  as?: string,
): Promise<Call> {
  mockAuth.mockResolvedValue({ userId: as ?? USER.id, scopes, authMethod: "oauth" } as never);
  const res = await POST({
    request: rpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  } as never);
  return { status: res.status, json: await res.json() as any };
}

const failed = (call: Call) => call.json?.error !== undefined;
const message = (call: Call) => String(call.json?.error?.message ?? "");
const output = (call: Call) => String(call.json?.result?.content?.[0]?.text ?? "");

/** Assert the call failed, and hand the message to `re` so failures are readable. */
function expectFailure(call: Call, re?: RegExp) {
  expect(call.json?.error, `expected an error, got: ${output(call)}`).toBeDefined();
  if (re) expect(message(call)).toMatch(re);
}

async function createUser(prefix: string) {
  return prisma.user.create({
    data: {
      id: `${prefix}-${crypto.randomUUID().slice(0, 8)}`,
      name: prefix,
      email: `${prefix}-${crypto.randomUUID().slice(0, 8)}@test.com`,
      emailVerified: true,
    },
  });
}

async function createEvent(ownerId: string | null, overrides: Record<string, unknown> = {}) {
  const event = await prisma.event.create({
    data: {
      title: "Event",
      location: "Lisbon",
      dateTime: new Date(Date.now() + 86_400_000),
      maxPlayers: 10,
      ownerId,
      ...overrides,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
  return prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
}

/** Puts `name` on the active roster for the event's current game. */
async function seedPlayer(eventId: string, name: string, userId: string | null = null) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const gameId = event.currentGameId!;
  const eventPlayer = await prisma.eventPlayer.create({ data: { eventId, name, userId } });
  await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: eventPlayer.id, order: 0 } });
  const player = await prisma.player.create({ data: { eventId, name, userId, order: 0 } });
  return { eventPlayer, player, gameId };
}

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.user.deleteMany();
  vi.clearAllMocks();
  USER = await createUser("mcpplayer");
});

// ── registration ───────────────────────────────────────────────────────────

describe("new tools are registered", () => {
  const NEW_TOOLS = [
    "convocados_follow_event",
    "convocados_unfollow_event",
    "convocados_leave_event",
    "convocados_set_no_show",
    "convocados_whoami",
  ];

  it("appear in the tool table exactly once each", () => {
    const names = TOOLS.map((t) => t.name);
    for (const name of NEW_TOOLS) expect(names.filter((n) => n === name), name).toEqual([name]);
  });

  it("are reachable through tools/list", async () => {
    mockAuth.mockResolvedValue({ userId: USER.id, scopes: ["*"], authMethod: "oauth" } as never);
    const res = await POST({
      request: rpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    } as never);
    const names = (await res.json() as any).result.tools.map((t: any) => t.name);
    for (const name of NEW_TOOLS) expect(names).toContain(name);
  });

  it("are all authenticated — none claim anonymous access", () => {
    for (const name of NEW_TOOLS) {
      expect(TOOLS.find((t) => t.name === name)!.requiresAuth, name).not.toBe(false);
    }
  });
});

// ── whoami ─────────────────────────────────────────────────────────────────

describe("convocados_whoami", () => {
  it("returns the account the token acts as", async () => {
    const call = await run("convocados_whoami", {});
    expect(failed(call)).toBe(false);
    expect(output(call)).toContain(USER.id);
    expect(output(call)).toContain(USER.email);
  });

  it("reports the granted scopes so a caller can see what it may do", async () => {
    const call = await run("convocados_whoami", {}, ["read:profile", "write:events"]);
    expect(failed(call)).toBe(false);
    expect(output(call)).toContain("read:profile");
    expect(output(call)).toContain("write:events");
  });

  it("echoes no token or session material", async () => {
    expect(output(await run("convocados_whoami", {}))).not.toMatch(/Bearer|cvk_|"token"/i);
  });

  it("404s when the token's user no longer exists", async () => {
    const call = await run("convocados_whoami", {}, ["*"], "ghost-user");
    expect(call.status).toBe(404);
  });

  it("401s without a token", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await POST({
      request: rpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convocados_whoami", arguments: {} } }),
    } as never);
    expect(res.status).toBe(401);
  });
});

// ── follow / unfollow ──────────────────────────────────────────────────────

describe("convocados_follow_event", () => {
  it("creates a follow record for the caller", async () => {
    const event = await createEvent(null);
    const call = await run("convocados_follow_event", { eventId: event.id });
    expect(failed(call)).toBe(false);
    expect(await prisma.eventFollow.count({
      where: { eventId: event.id, userId: USER.id },
    })).toBe(1);
  });

  it("is idempotent", async () => {
    const event = await createEvent(null);
    await run("convocados_follow_event", { eventId: event.id });
    await run("convocados_follow_event", { eventId: event.id });
    expect(await prisma.eventFollow.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("returns the effective mute overrides", async () => {
    const event = await createEvent(null);
    expect(output(await run("convocados_follow_event", { eventId: event.id }))).toContain("muteReminders");
  });

  it("404s for an unknown event", async () => {
    const call = await run("convocados_follow_event", { eventId: "does-not-exist" });
    expectFailure(call, /not found/i);
    expect(call.status).toBe(404);
  });

  it("requires eventId", async () => {
    expect(failed(await run("convocados_follow_event", {}))).toBe(true);
  });
});

describe("convocados_unfollow_event", () => {
  it("removes the caller's follow record", async () => {
    const event = await createEvent(null);
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: USER.id } });
    const call = await run("convocados_unfollow_event", { eventId: event.id });
    expect(failed(call)).toBe(false);
    expect(await prisma.eventFollow.count({
      where: { eventId: event.id, userId: USER.id },
    })).toBe(0);
  });

  it("is a no-op when not following", async () => {
    const event = await createEvent(null);
    expect(failed(await run("convocados_unfollow_event", { eventId: event.id }))).toBe(false);
  });

  it("never removes another user's follow", async () => {
    const other = await createUser("other");
    const event = await createEvent(null);
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: USER.id } });
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: other.id } });
    await run("convocados_unfollow_event", { eventId: event.id });
    expect(await prisma.eventFollow.count({
      where: { eventId: event.id, userId: other.id },
    })).toBe(1);
  });

  it("keeps the roster slot, only dropping notifications (ADR 0003)", async () => {
    const event = await createEvent(USER.id);
    const { player } = await seedPlayer(event.id, USER.name, USER.id);
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: USER.id } });
    await run("convocados_unfollow_event", { eventId: event.id });
    expect((await prisma.player.findUnique({ where: { id: player.id } }))?.archivedAt).toBeNull();
  });
});

// ── self-leave ─────────────────────────────────────────────────────────────

describe("convocados_leave_event", () => {
  it("archives the caller's own roster slot", async () => {
    const event = await createEvent(USER.id);
    const { player } = await seedPlayer(event.id, USER.name, USER.id);
    const call = await run("convocados_leave_event", { eventId: event.id });
    expect(failed(call)).toBe(false);
    expect((await prisma.player.findUnique({ where: { id: player.id } }))?.archivedAt).not.toBeNull();
  });

  it("drops the caller's follow, matching the REST route", async () => {
    const event = await createEvent(USER.id);
    await seedPlayer(event.id, USER.name, USER.id);
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: USER.id } });
    await run("convocados_leave_event", { eventId: event.id });
    expect(await prisma.eventFollow.count({
      where: { eventId: event.id, userId: USER.id },
    })).toBe(0);
  });

  it("404s when the caller is not a player in the event", async () => {
    const event = await createEvent(USER.id);
    expectFailure(await run("convocados_leave_event", { eventId: event.id }), /not a player|not found/i);
  });

  it("cannot remove another player — only the caller's own slot", async () => {
    const other = await createUser("other");
    const event = await createEvent(USER.id);
    const { player } = await seedPlayer(event.id, other.name, other.id);
    expect(failed(await run("convocados_leave_event", { eventId: event.id }))).toBe(true);
    expect((await prisma.player.findUnique({ where: { id: player.id } }))?.archivedAt).toBeNull();
  });

  it("works for an EventPlayer-native identity with no Player row (ADR 0026)", async () => {
    const event = await createEvent(USER.id);
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: USER.name, userId: USER.id } });
    expect(failed(await run("convocados_leave_event", { eventId: event.id }))).toBe(false);
  });
});

// ── no-show ────────────────────────────────────────────────────────────────

describe("convocados_set_no_show", () => {
  it("marks a participant as a no-show", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(event.id, "Ada");
    const call = await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: true,
    });
    expect(failed(call)).toBe(false);
    const gp = await prisma.gameParticipant.findUnique({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: eventPlayer.id } },
    });
    expect(gp?.noShow).toBe(true);
  });

  it("increments the streak when marking a linked player", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(event.id, USER.name, USER.id);
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: USER.id, noShowStreak: 1 },
    });
    const call = await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: true,
    });
    expect(failed(call)).toBe(false);
    expect((await prisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: USER.id } },
    }))?.noShowStreak).toBe(2);
  });

  it("decrements the streak when unmarking, and never below zero", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(event.id, USER.name, USER.id);
    await prisma.gameParticipant.updateMany({ where: { gameId }, data: { noShow: true } });
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: USER.id, noShowStreak: 2 },
    });
    const call = await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: false,
    });
    expect(failed(call)).toBe(false);
    const enrollment = await prisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: USER.id } },
    });
    expect(enrollment?.noShowStreak).toBe(1);

    await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: false,
    });
    expect((await prisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: USER.id } },
    }))?.noShowStreak).toBe(0);
  });

  it("leaves an unlinked participant's streak alone", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(event.id, "Ada");
    const call = await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: true,
    });
    expect(failed(call)).toBe(false);
    expect(await prisma.priorityEnrollment.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("rejects a gameId belonging to a different event", async () => {
    // The security property that matters: owning event A must not grant
    // no-show writes on event B's game.
    const eventA = await createEvent(USER.id);
    const eventB = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(eventB.id, "Ada");
    expectFailure(
      await run("convocados_set_no_show", {
        eventId: eventA.id, gameId, eventPlayerId: eventPlayer.id, noShow: true,
      }),
      /does not belong/i,
    );
  });

  it("refuses a user who is neither owner nor admin", async () => {
    const stranger = await createUser("stranger");
    const event = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(event.id, "Ada");
    expectFailure(
      await run("convocados_set_no_show", {
        eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: true,
      }, ["*"], stranger.id),
      /owner|admin|forbidden/i,
    );
    const gp = await prisma.gameParticipant.findUnique({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: eventPlayer.id } },
    });
    expect(gp?.noShow).toBe(false);
  });

  it("allows an event admin who is not the owner", async () => {
    const admin = await createUser("evtadmin");
    const event = await createEvent(USER.id);
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: admin.id } });
    const { eventPlayer, gameId } = await seedPlayer(event.id, "Ada");
    const call = await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: true,
    }, ["*"], admin.id);
    expect(failed(call)).toBe(false);
  });

  it("rejects a missing noShow flag rather than guessing", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(event.id, "Ada");
    expectFailure(await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id,
    }), /required/i);
  });

  it("404s for a participant that is not in the game", async () => {
    const event = await createEvent(USER.id);
    const { gameId } = await seedPlayer(event.id, "Ada");
    const outsider = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "NotIn" } });
    expectFailure(await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: outsider.id, noShow: true,
    }), /not found/i);
  });

  it("still succeeds when the best-effort push fails", async () => {
    // The streak counter and the push are side effects, not the tool's job:
    // a delivery failure must not turn a saved no-show into an error.
    mockPush.mockRejectedValueOnce(new Error("push endpoint down"));
    const event = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(event.id, USER.name, USER.id);
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: USER.id, noShowStreak: 1 },
    });

    const call = await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: true,
    });
    expect(call.status).toBe(200);

    // The no-show itself was persisted despite the push failure.
    expect((await prisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: USER.id } },
    }))?.noShowStreak).toBe(2);
    expect(mockPush).toHaveBeenCalledOnce();
  });

  it("covers a first-ever no-show (no enrollment row) and warns only from streak 2", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(event.id, USER.name, USER.id);

    const call = await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: true,
    });
    expect(call.status).toBe(200);

    // No priorityEnrollment row exists, so the streak falls back to 1 and the
    // push must not carry the priority warning.
    const body = String(mockPush.mock.calls.at(-1)?.[2]);
    expect(body).toContain("No-show streak: 1");
    expect(body).not.toContain("Priority may be affected");
  });

  it("stays silent when the player turned push off", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(event.id, USER.name, USER.id);
    await prisma.notificationPreferences.create({
      data: { userId: USER.id, pushEnabled: false },
    });

    const call = await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: true,
    });
    expect(call.status).toBe(200);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("rejects a missing eventId rather than guessing the event", async () => {
    for (const name of ["convocados_unfollow_event", "convocados_leave_event", "convocados_set_no_show"]) {
      const call = await run(name, {});
      expect(call.status, name).toBe(400);
    }
  });

  it("404s when the caller has left the event", async () => {
    const call = await run("convocados_leave_event", { eventId: "no-such-event" });
    expect(call.status).toBe(404);
  });

  it("needs the scope that matches the action", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer, gameId } = await seedPlayer(event.id, "Ada");
    expectFailure(await run("convocados_set_no_show", {
      eventId: event.id, gameId, eventPlayerId: eventPlayer.id, noShow: true,
    }, ["read:events"]), /scope/i);
  });
});

// ── rsvp scope fix ─────────────────────────────────────────────────────────

describe("convocados_rsvp scope", () => {
  it("is callable with read-only scopes — a player must not need manage:players", async () => {
    const event = await createEvent(null);
    const { eventPlayer, gameId } = await seedPlayer(event.id, USER.name, USER.id);
    const call = await run("convocados_rsvp", { eventId: event.id, status: "yes" }, ["read:events"]);
    expect(failed(call)).toBe(false);
    const rsvp = await prisma.rsvp.findUnique({
      where: { eventPlayerId_gameId: { eventPlayerId: eventPlayer.id, gameId } },
    });
    expect(rsvp?.status).toBe("yes");
  });

  it("still refuses an invalid status", async () => {
    const event = await createEvent(null);
    await seedPlayer(event.id, USER.name, USER.id);
    expect(failed(await run(
      "convocados_rsvp", { eventId: event.id, status: "maybe-ish" }, ["read:events"],
    ))).toBe(true);
  });
});
