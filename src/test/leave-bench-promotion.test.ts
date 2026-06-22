import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

vi.mock("~/lib/db.server", () => {
  const { PrismaClient: PC } = require("@prisma/client");
  const p = new PC({ datasources: { db: { url: process.env.DATABASE_URL } } });
  return { prisma: p };
});

import { POST as randomizePost } from "~/pages/api/events/[id]/randomize";

const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: async () => ({ isOwner: true, isAdmin: false, session: null }),
}));

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/apiRateLimit.server", () => ({
  rateLimitResponse: vi.fn().mockResolvedValue(null),
  resetApiRateLimitStore: vi.fn(),
}));

vi.mock("~/lib/eventLog.server", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(async () => {
  await testPrisma.teamMember.deleteMany();
  await testPrisma.teamResult.deleteMany();
  await testPrisma.playerRating.deleteMany();
  await testPrisma.rsvp.deleteMany();
  await testPrisma.eventAdmin.deleteMany();
  await testPrisma.eventFollow.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.user.deleteMany();
  vi.clearAllMocks();
});

function ctx(eventId: string) {
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/randomize`, { method: "POST" }),
    url: new URL(`http://localhost/api/events/${eventId}/randomize`),
  } as any;
}

async function getTeamNames(eventId: string) {
  const teams = await testPrisma.teamResult.findMany({
    where: { eventId },
    include: { members: { orderBy: { order: "asc" } } },
  });
  return teams.flatMap(t => t.members.map(m => m.name));
}

/**
 * Regression: the /randomize endpoint must never include archived (soft-deleted)
 * players in the generated teams.
 *
 * Root cause: `archiveAndLeave` re-indexes the remaining *non-archived* players
 * but does NOT touch the archived row's `order`. So if TF was at order 9 and
 * Manecas was at order 10 (bench), after TF declines:
 *   - TF stays at order 9 (archived)
 *   - Manecas gets re-indexed from order 10 to 9
 * Both rows now share `order: 9`. The randomize endpoint does
 *   prisma.player.findMany({ where: { eventId }, orderBy: { order: "asc" } })
 * with no `archivedAt: null` filter, so it returns 11 rows. `slice(0, maxPlayers)`
 * picks whichever wins the secondary sort — and on the production DB the
 * archived row wins, so the team gets TF back and Manecas is silently dropped.
 *
 * The fix is to add `archivedAt: null` to the randomize query (and any other
 * active-list query that doesn't already filter it).
 */
describe("Regression: randomize must not include archived players in teams", () => {
  it("excludes a soft-archived player that shares an `order` with an active bench replacement", async () => {
    const owner = await testPrisma.user.create({
      data: { id: "owner", name: "José", email: "jose@t.com", emailVerified: true },
    });

    const event = await testPrisma.event.create({
      data: {
        title: "Ninjas da Areosa",
        location: "Pitch",
        dateTime: new Date(Date.now() + 5 * 3600_000),
        maxPlayers: 10,
        ownerId: owner.id,
      },
    });

    // 10 active players (orders 0..8 + Manecas at order 9 — Manecas was the
    // bench replacement after TF was archived). TF is archived but still at
    // order 9 — this is the exact state archiveAndLeave leaves the DB in.
    // The current randomize query has no `archivedAt: null` filter, so it
    // returns 11 rows and the tie at order 9 silently bumps one of the two
    // out. The fix must filter to active rows.
    const activeNames = [
      "João Fernandes", "coutinho", "Gonçalo", "José Cabeda", "Murilo",
      "João Lopes", "rodrigo", "Igor Carvalho", "Enair", "Manecas",
    ];
    let order = 0;
    for (const name of activeNames) {
      await testPrisma.player.create({ data: { eventId: event.id, name, order: order++ } });
    }
    // Force TF to be the one that wins the secondary sort: insert it with a
    // cuids that sorts BEFORE all the active rows on the secondary key. We
    // can't pick a specific cuid, but we can guarantee it by inserting TF
    // *before* the active rows and then bumping the active rows' orders up.
    const tf = await testPrisma.player.create({
      data: { eventId: event.id, name: "TF", order: 99, archivedAt: new Date() },
    });
    // Now move TF down to order 9 — the same leftover state archiveAndLeave
    // produces. Its rowid (and thus its secondary-sort position) is still
    // the oldest of the bunch, so it deterministically wins the tie.
    await testPrisma.player.update({ where: { id: tf.id }, data: { order: 9 } });
    // Bump every active row up by one so TF is the only row at order 9.
    for (const name of activeNames) {
      const p = await testPrisma.player.findFirst({ where: { eventId: event.id, name } });
      await testPrisma.player.update({ where: { id: p!.id }, data: { order: p!.order + 1 } });
    }
    // Sanity: the active rows are now at orders 1..10 and TF is at 9.
    const tfCheck = await testPrisma.player.findUnique({ where: { id: tf.id } });
    expect(tfCheck?.order).toBe(9);
    expect(tfCheck?.archivedAt).not.toBeNull();

    const r = await randomizePost(ctx(event.id));
    expect(r.status).toBe(200);

    const teamNames = await getTeamNames(event.id);
    // Without the fix, TF wins the order=9 tie and bumps João Fernandes
    // (now at order 10) out of the team — and the team contains the
    // archived TF. With the fix, the team contains Manecas and no TF.
    expect(teamNames).toHaveLength(10);
    expect(teamNames).toContain("Manecas");
    expect(teamNames).not.toContain("TF");
    expect(teamNames).toContain("João Fernandes");
  });

  it("excludes any archived player even when its `order` is below maxPlayers", async () => {
    const owner = await testPrisma.user.create({
      data: { id: "owner", name: "José", email: "jose@t.com", emailVerified: true },
    });

    const event = await testPrisma.event.create({
      data: {
        title: "Test",
        location: "Pitch",
        dateTime: new Date(Date.now() + 5 * 3600_000),
        maxPlayers: 5,
        ownerId: owner.id,
      },
    });

    // 4 active + 1 archived (Ghost) at order 0. The current randomize query
    // would return Ghost first and exclude the 4 active players.
    for (const [i, name] of ["Alice", "Bob", "Carol", "Dave"].entries()) {
      await testPrisma.player.create({ data: { eventId: event.id, name, order: i + 1 } });
    }
    await testPrisma.player.create({
      data: { eventId: event.id, name: "Ghost", order: 0, archivedAt: new Date() },
    });

    const r = await randomizePost(ctx(event.id));
    expect(r.status).toBe(200);

    const teamNames = await getTeamNames(event.id);
    expect(teamNames).toHaveLength(4);
    expect(teamNames).not.toContain("Ghost");
    expect(teamNames.sort()).toEqual(["Alice", "Bob", "Carol", "Dave"]);
  });
});
