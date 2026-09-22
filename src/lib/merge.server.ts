/**
 * Cross-account merge (ADR 0040): absorb `absorbedId` into `survivorId`.
 *
 * Rules (settled in grilling → ADR 0040):
 * - Transfer every foreign key from absorbed → survivor.
 * - Unique collisions (EventFollow, SeasonMembership, PushSubscription, UserAppOpen, …):
 *   survivor row wins, absorbed row discarded.
 * - Singleton NotificationPreferences: survivor keeps theirs; absorbed's deleted.
 * - Google Account always moves (unique is issuer+accountId). Absorbed password
 *   Account kept only if survivor has none; else discarded.
 * - Absorbed User hard-deleted → leftover cascade rows die; Primary email freed.
 * - Absorbed sessions deleted first (hard logout; no session transfer).
 * - Player identity is name-keyed (ADR 0016): the absorbed user's per-event
 *   player rows are collapsed into the survivor's player name for that event
 *   (or the survivor's account name when they have no player row there), so
 *   game history / ratings / rankings show one person.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { mergePlayerIdentity } from "./mergePlayer.server";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface MergeResult {
  survivorUserId: string;
  absorbedUserId: string;
  transferredAccounts: number;
  discardedAccounts: number;
  /** Events whose player identity was collapsed (callers recalc ELO after commit). */
  mergedPlayerEvents: string[];
}

/**
 * Resolve the name the survivor's player identity should end up under in an
 * event: their existing per-event player name, else rating/legacy name, else
 * their account name.
 */
async function resolveSurvivorPlayerName(
  tx: Tx,
  eventId: string,
  survivorId: string,
  accountName: string,
): Promise<string> {
  const ep = await tx.eventPlayer.findFirst({
    where: { eventId, userId: survivorId },
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });
  if (ep) return ep.name;
  const rating = await tx.playerRating.findFirst({
    where: { eventId, userId: survivorId },
    select: { name: true },
  });
  if (rating) return rating.name;
  const legacy = await tx.player.findFirst({
    where: { eventId, userId: survivorId },
    select: { name: true },
  });
  if (legacy) return legacy.name;
  return accountName;
}

/**
 * Collapse every name the absorbed user played under into the survivor's name,
 * per event. Must run before the generic `userId` repoints, which would
 * otherwise erase the evidence of which names belonged to the absorbed user.
 * Returns the affected event ids.
 */
async function mergeUserPlayerIdentities(
  tx: Tx,
  survivorId: string,
  absorbedId: string,
  survivorAccountName: string,
): Promise<string[]> {
  const [absorbedEps, absorbedRatings, absorbedPlayers] = await Promise.all([
    tx.eventPlayer.findMany({ where: { userId: absorbedId }, select: { eventId: true, name: true } }),
    tx.playerRating.findMany({ where: { userId: absorbedId }, select: { eventId: true, name: true } }),
    tx.player.findMany({ where: { userId: absorbedId }, select: { eventId: true, name: true } }),
  ]);

  const namesByEvent = new Map<string, Set<string>>();
  const add = (eventId: string, name: string) => {
    let set = namesByEvent.get(eventId);
    if (!set) {
      set = new Set();
      namesByEvent.set(eventId, set);
    }
    set.add(name);
  };
  for (const r of absorbedEps) add(r.eventId, r.name);
  for (const r of absorbedRatings) add(r.eventId, r.name);
  for (const r of absorbedPlayers) add(r.eventId, r.name);

  const mergedEvents: string[] = [];
  for (const [eventId, names] of namesByEvent) {
    const targetName = await resolveSurvivorPlayerName(tx, eventId, survivorId, survivorAccountName);
    for (const sourceName of names) {
      if (sourceName === targetName) continue;
      await mergePlayerIdentity(tx, eventId, sourceName, targetName, survivorId);
    }
    mergedEvents.push(eventId);
  }
  return mergedEvents;
}

async function transferAccounts(tx: Tx, absorbedId: string, survivorId: string) {
  const accounts = await tx.account.findMany({ where: { userId: absorbedId } });
  const survivorAccounts = await tx.account.findMany({ where: { userId: survivorId } });
  let transferred = 0;
  let discarded = 0;

  for (const acc of accounts) {
    const survivorHasSameProvider = survivorAccounts.some((s) => s.providerId === acc.providerId);
    // Google: always move (issuer+accountId unique is the identity tie-point).
    // Other providers (credential, future OAuth): keep only if survivor lacks that provider.
    if (acc.providerId !== "google" && survivorHasSameProvider) {
      await tx.account.delete({ where: { id: acc.id } });
      discarded++;
      continue;
    }
    await tx.account.update({ where: { id: acc.id }, data: { userId: survivorId } });
    transferred++;
  }
  return { transferred, discarded };
}

export async function mergeUsers(tx: Tx, survivorId: string, absorbedId: string): Promise<MergeResult> {
  if (survivorId === absorbedId) {
    throw new Error("Cannot merge a user into itself");
  }

  const survivor = await tx.user.findUnique({ where: { id: survivorId } });
  const absorbed = await tx.user.findUnique({ where: { id: absorbedId } });
  if (!survivor) throw new Error("Survivor user not found");
  if (!absorbed) throw new Error("Absorbed user not found");

  // Singleton: survivor keeps theirs (ADR 0040).
  await tx.notificationPreferences.deleteMany({ where: { userId: absorbedId } });

  // Sessions first: hard logout of absorbed devices (ADR 0040 Q14).
  await tx.session.deleteMany({ where: { userId: absorbedId } });

  // ── Unique-collision collections (survivor wins) ──────────────────────────
  {
    const rows = await tx.eventFollow.findMany({ where: { userId: absorbedId } });
    for (const r of rows) {
      const conflict = await tx.eventFollow.findFirst({ where: { eventId: r.eventId, userId: survivorId } });
      if (conflict) await tx.eventFollow.delete({ where: { id: r.id } });
      else await tx.eventFollow.update({ where: { id: r.id }, data: { userId: survivorId } });
    }
  }
  {
    const rows = await tx.seasonMembership.findMany({ where: { userId: absorbedId } });
    for (const r of rows) {
      const conflict = await tx.seasonMembership.findFirst({ where: { seasonId: r.seasonId, userId: survivorId } });
      if (conflict) await tx.seasonMembership.delete({ where: { id: r.id } });
      else await tx.seasonMembership.update({ where: { id: r.id }, data: { userId: survivorId } });
    }
  }
  {
    const rows = await tx.pushSubscription.findMany({ where: { userId: absorbedId } });
    for (const r of rows) {
      const conflict = await tx.pushSubscription.findFirst({ where: { userId: survivorId, endpoint: r.endpoint } });
      if (conflict) await tx.pushSubscription.delete({ where: { id: r.id } });
      else await tx.pushSubscription.update({ where: { id: r.id }, data: { userId: survivorId } });
    }
  }
  {
    const rows = await tx.userAppOpen.findMany({ where: { userId: absorbedId } });
    for (const r of rows) {
      const conflict = await tx.userAppOpen.findFirst({ where: { userId: survivorId, day: r.day } });
      if (conflict) await tx.userAppOpen.delete({ where: { id: r.id } });
      else await tx.userAppOpen.update({ where: { id: r.id }, data: { userId: survivorId } });
    }
  }
  {
    const rows = await tx.appPushToken.findMany({ where: { userId: absorbedId } });
    for (const r of rows) {
      const conflict = await tx.appPushToken.findFirst({ where: { token: r.token, userId: survivorId } });
      if (conflict) await tx.appPushToken.delete({ where: { id: r.id } });
      else await tx.appPushToken.update({ where: { id: r.id }, data: { userId: survivorId } });
    }
  }

  // ── Accounts ──────────────────────────────────────────────────────────────
  const { transferred, discarded } = await transferAccounts(tx, absorbedId, survivorId);

  // ── Player identity (name-keyed, ADR 0016) ────────────────────────────────
  // Collapse the absorbed user's per-event player names into the survivor's
  // before the generic userId repoints erase which names were theirs.
  const mergedPlayerEvents = await mergeUserPlayerIdentities(tx, survivorId, absorbedId, survivor.name);

  // ── Simple userId repoints (no cross-user unique) ─────────────────────────
  await tx.event.updateMany({ where: { ownerId: absorbedId }, data: { ownerId: survivorId } });
  await tx.season.updateMany({ where: { createdByUserId: absorbedId }, data: { createdByUserId: survivorId } });
  await tx.rsvp.updateMany({ where: { respondedByUserId: absorbedId }, data: { respondedByUserId: survivorId } });
  await tx.crewProposal.updateMany({ where: { reviewedByUserId: absorbedId }, data: { reviewedByUserId: survivorId } });

  // Player / PlayerRating / EventPlayer: (eventId, name) is globally unique — same row can't collide across users.
  await tx.player.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.playerRating.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.eventPlayer.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });

  await tx.calendarToken.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.apiKey.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.priorityEnrollment.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.priorityConfirmation.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.eventInvite.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.eventAdmin.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.inAppNotification.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.oauthClient.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.oauthAccessToken.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.oauthRefreshToken.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.oauthConsent.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.courtWatch.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.monthlySubscription.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.walletTransaction.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } });
  await tx.playerInvite.updateMany({ where: { invitedByUserId: absorbedId }, data: { invitedByUserId: survivorId } });
  await tx.crewProposalInvite.updateMany(
    { where: { invitedByUserId: absorbedId }, data: { invitedByUserId: survivorId } },
  );
  await tx.crewProposalInvite.updateMany(
    { where: { claimedByUserId: absorbedId }, data: { claimedByUserId: survivorId } },
  );

  // Raw userId columns with no Prisma relation on User.
  await tx.$executeRaw`UPDATE "Player" SET "invitedByUserId" = ${survivorId} WHERE "invitedByUserId" = ${absorbedId}`;
  await tx.$executeRaw`UPDATE "PaymentReminderLog" SET "userId" = ${survivorId} WHERE "userId" = ${absorbedId}`;
  await tx.$executeRaw`UPDATE "PaymentNudgeStage" SET "userId" = ${survivorId} WHERE "userId" = ${absorbedId}`;

  // Delete absorbed user → frees Primary email (ADR 0040 Q9).
  await tx.user.delete({ where: { id: absorbedId } });

  return {
    survivorUserId: survivorId,
    absorbedUserId: absorbedId,
    transferredAccounts: transferred,
    discardedAccounts: discarded,
    mergedPlayerEvents,
  };
}
