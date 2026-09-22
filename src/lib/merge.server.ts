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
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface MergeResult {
  survivorUserId: string;
  absorbedUserId: string;
  transferredAccounts: number;
  discardedAccounts: number;
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
  };
}
