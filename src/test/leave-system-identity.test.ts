import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { applyRosterChange } from "~/lib/applyRosterChange.server";
import { resolveRosterTarget } from "~/lib/rosterCore.server";
import { systemUserId } from "~/lib/payerIdentity.server";
import { canRemoveEventPlayer } from "~/lib/eventView";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function loadEvent(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { where: { archivedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!event) throw new Error("seed event missing");
  return event;
}

/**
 * Production report (Ninjas da Areosa, player "TF"): the roster rows the event
 * page renders for "TF" are linked to the synthetic ledger placeholder user
 * `system:<eventId>:<name>` instead of a real account, and every self-removal
 * path matches the caller by `userId === session.user.id`. With no match the
 * web hides both the Leave button and the X, and POST /leave answers 404
 * "You are not a player in this event." — the player is stranded on the list.
 *
 * Root cause of the link: name-based identity resolution
 * (`resolveRosterTarget`, the auto-link branch of `applyRosterChange`) picks the
 * unique User whose normalized name matches. The ledger placeholder is itself
 * named after the player, so it wins that contest and is written onto the
 * Player/EventPlayer rows. `/api/events/[id]/suggestions` already excludes
 * these placeholders (see src/test/invite-consistency.test.ts,
 * "never resolves to a system ledger placeholder user"); the roster paths did
 * not.
 */
describe("roster identity never resolves to a synthetic ledger user", () => {
  beforeEach(async () => {
    await resetApiRateLimitStore();
    await prisma.notificationJob.deleteMany();
    await prisma.teamMember.deleteMany();
    await prisma.teamResult.deleteMany();
    await prisma.playerRating.deleteMany();
    await prisma.eventFollow.deleteMany();
    await prisma.playerPayment.deleteMany();
    await prisma.walletTransaction.deleteMany();
    await prisma.player.deleteMany();
    await prisma.eventPlayer.deleteMany();
    await prisma.gameParticipant.deleteMany();
    await prisma.rsvp.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedEventWithSystemUser(playerName: string) {
    const event = await prisma.event.create({
      data: {
        title: "T",
        location: "F",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A",
        teamTwoName: "B",
        maxPlayers: 10,
      },
    });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
    const systemId = systemUserId(event.id, playerName);
    await prisma.user.create({
      data: { id: systemId, name: playerName, email: `${systemId}@system.local`, emailVerified: false },
    });
    return event;
  }

  it("resolveRosterTarget treats a ledger placeholder as an anonymous roster entry", async () => {
    await seedEventWithSystemUser("TF");

    const target = await resolveRosterTarget({ name: "TF" });

    expect(target.name).toBe("TF");
    expect(target.userId).toBeNull();
    expect(target.user).toBeNull();
  });

  it("applyRosterChange never writes a ledger placeholder onto the Player row", async () => {
    const event = await seedEventWithSystemUser("TF");

    const result = await applyRosterChange({
      eventId: event.id,
      origin: "http://localhost",
      session: null,
      senderClientId: undefined,
      body: { name: "TF" },
      event: await loadEvent(event.id),
    });

    expect(result.status).toBe(200);

    const player = await prisma.player.findUnique({ where: { eventId_name: { eventId: event.id, name: "TF" } } });
    expect(player?.userId).toBeNull();

    const ep = await prisma.eventPlayer.findUnique({ where: { eventId_name: { eventId: event.id, name: "TF" } } });
    expect(ep?.userId).toBeNull();

    // A real account with the same display name still wins the unique match:
    // the placeholder must not be mistaken for the human.
    const human = await prisma.user.create({
      data: { id: "u_human", name: "TF", email: "tf@real.com", createdAt: new Date(), updatedAt: new Date() },
    });
    const later = await prisma.event.create({
      data: { title: "T2", location: "F", dateTime: new Date(Date.now() + 86400_000), teamOneName: "A", teamTwoName: "B", maxPlayers: 10 },
    });
    await prisma.user.create({
      data: { id: systemUserId(later.id, "TF"), name: "TF", email: `${systemUserId(later.id, "TF")}@system.local`, emailVerified: false },
    });
    const target = await resolveRosterTarget({ name: "TF" });
    expect(target.userId).toBe(human.id);
  });

  it("does not resolve a roster identity from a ledger placeholder's email", async () => {
    const event = await seedEventWithSystemUser("TF");
    const systemId = systemUserId(event.id, "TF");

    const result = await applyRosterChange({
      eventId: event.id,
      origin: "http://localhost",
      session: null,
      senderClientId: undefined,
      body: { name: "", email: `${systemId}@system.local` },
      event: await loadEvent(event.id),
    });

    // A placeholder email is not a registered account: the join is rejected
    // (name required) rather than linked to the synthetic user.
    expect(result.status).toBe(400);
    const player = await prisma.player.findFirst({ where: { eventId: event.id } });
    expect(player?.userId ?? null).toBeNull();
  });

  it("keeps an unlinked roster row removable by the human it names", async () => {
    const event = await seedEventWithSystemUser("TF");
    const player = await prisma.player.create({ data: { eventId: event.id, name: "TF", order: 0 } });

    expect(canRemoveEventPlayer("u_anyone", { ownerId: null, isPublic: false, isAdmin: false }, player)).toBe(true);
  });
});
