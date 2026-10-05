/**
 * MCP player-side and organiser gap tools.
 *
 * Covers follow/unfollow, self-leave, no-show marking and the token-debug tool,
 * plus the rsvp scope fix (a player must not need `manage:players` to answer).
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
import { TOOLS } from "~/lib/mcp/tools";
const mockAuth = vi.mocked(authenticateRequest);
const PROTOCOL = "2026-07-28";

let USER: { id: string; name: string; email: string };

function request(body: unknown) {
  return new Request("http://localhost:4321/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "MCP-Protocol-Version": PROTOCOL,
      "Mcp-Method": "tools/call",
    },
    body: JSON.stringify(body),
  });
}

/** Runs a tool as USER with the given scopes and returns the JSON-RPC envelope. */
async function run(name: string, args: Record<string, unknown>, scopes = ["*"], as?: string) {
  mockAuth.mockResolvedValue({ userId: as ?? USER.id, scopes, authMethod: "oauth" } as never);
  const res = await POST({
    request: request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  } as never);
  return await res.json() as any;
}

function resultText(json: any): string {
  return String(json?.result?.content?.[0]?.text ?? "");
}
function isError(json: any): boolean {
  return json?.result?.isError === true;
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

async function seedPlayer(eventId: string, name: string, userId: string | null = null) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  const ep = await prisma.eventPlayer.create({ data: { eventId, name, userId } });
  await prisma.gameParticipant.create({
    data: { gameId: event!.currentGameId!, eventPlayerId: ep.id, order: 0 },
  });
  const player = await prisma.player.create({ data: { eventId, name, userId, order: 0 } });
  return { eventPlayer: ep, player };
}

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.eventLog.deleteMany();
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
    const res = await POST({ request: request({ jsonrpc: "2.0", id: 1, method: "tools/list" }) } as never);
    const names = (await res.json() as any).result.tools.map((t: any) => t.name);
    for (const name of NEW_TOOLS) expect(names).toContain(name);
  });

  it("are all authenticated — none claim anonymous access", () => {
    for (const name of NEW_TOOLS) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(tool.requiresAuth, name).not.toBe(false);
    }
  });
});

// ── whoami ─────────────────────────────────────────────────────────────────

describe("convocados_whoami", () => {
  it("returns the account the token acts as", async () => {
    const json = await run("convocados_whoami", {});
    expect(isError(json)).toBe(false);
    const text = resultText(json);
    expect(text).toContain(USER.id);
    expect(text).toContain(USER.email);
  });

  it("reports the granted scopes so a caller can see what it may do", async () => {
    const json = await run("convocados_whoami", {}, ["read:events"]);
    expect(resultText(json)).toContain("read:events");
  });

  it("does not echo any token or session material", async () => {
    const json = await run("convocados_whoami", {});
    expect(resultText(json)).not.toMatch(/Bearer|cvk_|token/i);
  });
});

// ── follow / unfollow ──────────────────────────────────────────────────────

describe("convocados_follow_event", () => {
  it("creates a follow record for the caller", async () => {
    const event = await createEvent(null);
    const json = await run("convocados_follow_event", { eventId: event.id });
    expect(isError(json)).toBe(false);
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
    const json = await run("convocados_follow_event", { eventId: event.id });
    expect(resultText(json)).toContain("muteReminders");
  });

  it("404s for an unknown event", async () => {
    const json = await run("convocados_follow_event", { eventId: "does-not-exist" });
    expect(isError(json)).toBe(true);
    expect(resultText(json)).toContain("not found");
  });

  it("requires eventId", async () => {
    expect(isError(await run("convocados_follow_event", {}))).toBe(true);
  });
});

describe("convocados_unfollow_event", () => {
  it("removes the caller's follow record", async () => {
    const event = await createEvent(null);
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: USER.id } });
    const json = await run("convocados_unfollow_event", { eventId: event.id });
    expect(isError(json)).toBe(false);
    expect(await prisma.eventFollow.count({
      where: { eventId: event.id, userId: USER.id },
    })).toBe(0);
  });

  it("is a no-op when not following", async () => {
    const event = await createEvent(null);
    expect(isError(await run("convocados_unfollow_event", { eventId: event.id }))).toBe(false);
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
    const json = await run("convocados_leave_event", { eventId: event.id });
    expect(isError(json)).toBe(false);
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
    const json = await run("convocados_leave_event", { eventId: event.id });
    expect(isError(json)).toBe(true);
    expect(resultText(json)).toMatch(/not a player|not found/i);
  });

  it("cannot remove another player — only the caller's own slot", async () => {
    const other = await createUser("other");
    const event = await createEvent(USER.id);
    const { player } = await seedPlayer(event.id, other.name, other.id);
    const json = await run("convocados_leave_event", { eventId: event.id });
    expect(isError(json)).toBe(true);
    expect((await prisma.player.findUnique({ where: { id: player.id } }))?.archivedAt).toBeNull();
  });

  it("works for an EventPlayer-native identity with no Player row (ADR 0026)", async () => {
    const event = await createEvent(USER.id);
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: USER.name, userId: USER.id } });
    const json = await run("convocados_leave_event", { eventId: event.id });
    expect(isError(json)).toBe(false);
  });
});

// ── no-show ────────────────────────────────────────────────────────────────

describe("convocados_set_no_show", () => {
  it("marks a participant as a no-show", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer } = await seedPlayer(event.id, "Ada");
    const json = await run("convocados_set_no_show", {
      eventId: event.id,
      gameId: event.currentGameId,
      eventPlayerId: eventPlayer.id,
      noShow: true,
    });
    expect(isError(json)).toBe(false);
    const gp = await prisma.gameParticipant.findUnique({
      where: { gameId_eventPlayerId: { gameId: event.currentGameId!, eventPlayerId: eventPlayer.id } },
    });
    expect(gp?.noShow).toBe(true);
  });

  it("unmarks on noShow=false and decrements the streak", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer } = await seedPlayer(event.id, "Ada");
    await prisma.gameParticipant.updateMany({
      where: { gameId: event.currentGameId! },
      data: { noShow: true },
    });
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: USER.id, noShowStreak: 2 },
    });
    await run("convocados_set_no_show", {
      eventId: event.id,
      gameId: event.currentGameId,
      eventPlayerId: eventPlayer.id,
      noShow: false,
    });
    const enrollment = await prisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: USER.id } },
    });
    expect(enrollment?.noShowStreak).toBe(1);
  });

  it("increments the streak on noShow=true", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer } = await seedPlayer(event.id, "Ada");
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: USER.id, noShowStreak: 1 },
    });
    await run("convocados_set_no_show", {
      eventId: event.id,
      gameId: event.currentGameId,
      eventPlayerId: eventPlayer.id,
      noShow: true,
    });
    const enrollment = await prisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: USER.id } },
    });
    expect(enrollment?.noShowStreak).toBe(2);
  });

  it("rejects a gameId belonging to a different event", async () => {
    // The security property that matters: owning event A must not grant
    // no-show writes on event B's game.
    const eventA = await createEvent(USER.id);
    const eventB = await createEvent(USER.id);
    const { eventPlayer } = await seedPlayer(eventB.id, "Ada");
    const json = await run("convocados_set_no_show", {
      eventId: eventA.id,
      gameId: eventB.currentGameId,
      eventPlayerId: eventPlayer.id,
      noShow: true,
    });
    expect(isError(json)).toBe(true);
    expect(resultText(json)).toContain("does not belong");
  });

  it("refuses a user who is neither owner nor admin", async () => {
    const stranger = await createUser("stranger");
    const event = await createEvent(USER.id);
    const { eventPlayer } = await seedPlayer(event.id, "Ada");
    const json = await run("convocados_set_no_show", {
      eventId: event.id,
      gameId: event.currentGameId,
      eventPlayerId: eventPlayer.id,
      noShow: true,
    }, ["*"], stranger.id);
    expect(isError(json)).toBe(true);
    expect(resultText(json)).toMatch(/owner|admin|forbidden/i);
  });

  it("allows an event admin who is not the owner", async () => {
    const admin = await createUser("evtadmin");
    const event = await createEvent(USER.id);
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: admin.id } });
    const { eventPlayer } = await seedPlayer(event.id, "Ada");
    const json = await run("convocados_set_no_show", {
      eventId: event.id,
      gameId: event.currentGameId,
      eventPlayerId: eventPlayer.id,
      noShow: true,
    }, ["*"], admin.id);
    expect(isError(json)).toBe(false);
  });

  it("rejects a missing noShow flag rather than guessing", async () => {
    const event = await createEvent(USER.id);
    const { eventPlayer } = await seedPlayer(event.id, "Ada");
    const json = await run("convocados_set_no_show", {
      eventId: event.id,
      gameId: event.currentGameId,
      eventPlayerId: eventPlayer.id,
    });
    expect(isError(json)).toBe(true);
  });

  it("404s for a participant that is not in the game", async () => {
    const event = await createEvent(USER.id);
    const outsider = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "NotIn" } });
    const json = await run("convocados_set_no_show", {
      eventId: event.id,
      gameId: event.currentGameId,
      eventPlayerId: outsider.id,
      noShow: true,
    });
    expect(isError(json)).toBe(true);
    expect(resultText(json)).toContain("not found");
  });
});

// ── rsvp scope fix ─────────────────────────────────────────────────────────

describe("convocados_rsvp scope", () => {
  it("is callable with read-only scopes — a player must not need manage:players", async () => {
    const event = await createEvent(null);
    const json = await run("convocados_rsvp", { eventId: event.id, status: "yes" }, ["read:events"]);
    expect(isError(json)).toBe(false);
    const rsvp = await prisma.rsvp.findFirst({
      where: { eventId: event.id, userId: USER.id },
    });
    expect(rsvp?.status).toBe("yes");
  });

  it("still refuses an invalid status", async () => {
    const event = await createEvent(null);
    expect(isError(await run(
      "convocados_rsvp", { eventId: event.id, status: "maybe-ish" }, ["read:events"],
    ))).toBe(true);
  });
});
