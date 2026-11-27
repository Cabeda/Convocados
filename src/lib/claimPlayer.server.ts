import type { Player } from "@prisma/client";
import type { SessionResult } from "./auth.helpers.server";
import { prisma } from "./db.server";
import { checkAccess } from "./eventAccess";
import { authorizeEventMutation, type AuthorizableEvent } from "./eventAuthz.server";
import { enqueuePushSetupHintSafe } from "./pushSetupHint";

export interface ClaimPlayerInput {
  playerId: string;
  userId: string;
  userName: string;
  /** The caller's request, so an ev_access cookie can authorize the claim. */
  request?: Request;
  /** A PlayerInvite token: the per-player capability for a locked Event. */
  inviteToken?: string | null;
}

export interface ClaimPlayerResult {
  ok: true;
  claimedPlayerId: string;
}

/** A claim denied by the Event's access rules — not a missing or linked player. */
export class ClaimPlayerForbiddenError extends Error {
  readonly reason?: "password_required";
  constructor(reason?: "password_required") {
    super("You do not have access to claim a player in this event.");
    this.name = "ClaimPlayerForbiddenError";
    this.reason = reason;
  }
}

/**
 * Self-service claims are authorized by the Event's own access rules, not by a
 * session alone: the owner/admin (the mutation seam), the link capability when
 * the Event is unlocked or the caller holds its password/EventInvite, or the
 * per-player PlayerInvite token. A password-locked Event must never let a bare
 * link holder rewrite a guest's identity.
 */
async function authorizeClaim(
  event: AuthorizableEvent,
  input: ClaimPlayerInput,
  targetEventPlayerId: string | null,
): Promise<void> {
  const request = input.request ?? new Request("http://localhost/");
  const session = {
    user: { id: input.userId, name: input.userName },
  } as unknown as SessionResult;
  const authz = await authorizeEventMutation(request, event, session);
  if (authz.allowed) return;

  const isInvited =
    (await prisma.eventInvite.count({ where: { eventId: event.id, userId: input.userId } })) > 0;
  const linkAccess = checkAccess({
    eventOwnerId: event.ownerId,
    accessPassword: event.accessPassword,
    requestUserId: input.userId,
    cookieHeader: input.request?.headers.get("cookie") ?? null,
    eventId: event.id,
    isInvited,
  });
  if (linkAccess.granted) return;

  if (await hasMatchingPlayerInvite(event.id, targetEventPlayerId, input.inviteToken)) return;

  throw new ClaimPlayerForbiddenError(event.accessPassword ? "password_required" : undefined);
}

/** Whether the token is an unanswered or accepted invite for this exact slot. */
async function hasMatchingPlayerInvite(
  eventId: string,
  targetEventPlayerId: string | null,
  token?: string | null,
): Promise<boolean> {
  if (!token || !targetEventPlayerId) return false;
  const invite = await prisma.playerInvite.findUnique({
    where: { token },
    select: { eventPlayerId: true, status: true, eventPlayer: { select: { eventId: true } } },
  });
  return (
    !!invite &&
    invite.eventPlayer.eventId === eventId &&
    invite.eventPlayerId === targetEventPlayerId &&
    (invite.status === "pending" || invite.status === "accepted")
  );
}

export async function claimPlayer(
  eventId: string,
  input: ClaimPlayerInput,
): Promise<ClaimPlayerResult> {
  const { playerId, userId, userName } = input;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { order: "asc" } } },
  });
  if (!event) throw new Error("Event not found");

  let target = event.players.find((p: Player) => p.id === playerId);
  if (!target) {
    const ep = await prisma.eventPlayer.findFirst({ where: { id: playerId, eventId } });
    if (ep) {
      target = event.players.find((p: Player) => p.name === ep.name && !p.archivedAt)
        ?? event.players.find((p: Player) => p.name === ep.name);
    }
  }

  let guestEp: { id: string; userId: string | null; name: string } | null = null;
  if (!target) {
    const ep = await prisma.eventPlayer.findFirst({ where: { id: playerId, eventId } });
    if (ep && !ep.userId) {
      guestEp = { id: ep.id, userId: ep.userId, name: ep.name };
    }
  }
  if (!target && !guestEp) throw new Error("Player not found.");

  const oldName: string = target?.name ?? guestEp?.name ?? "";
  const targetEventPlayerId =
    guestEp?.id ??
    (oldName
      ? (await prisma.eventPlayer.findFirst({
          where: { eventId, name: oldName },
          select: { id: true },
        }))?.id ?? null
      : null);

  await authorizeClaim(event, input, targetEventPlayerId);

  if (target?.archivedAt) {
    throw new Error("This player is archived and cannot be claimed.");
  }

  if (target?.userId) {
    throw new Error("This player is already linked to an account.");
  }

  const existing = event.players.find((p: Player) => p.userId === userId);
  if (existing) {
    throw new Error("You already have a linked player in this event.");
  }
  const existingEp = await prisma.eventPlayer.findFirst({
    where: { eventId, userId },
    select: { id: true },
  });
  if (existingEp) {
    throw new Error("You already have a linked player in this event.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (target) {
        const claimed = await tx.player.updateMany({
          where: { id: target.id, eventId, userId: null },
          data: { userId, name: userName },
        });
        if (claimed.count === 0) throw new Error("CLAIM_RACE");
        // Bind the unified roster identity too. RSVP resolves by userId and
        // refuses to relink an unclaimed guest row by display name, so leaving
        // the EventPlayer anonymous would strand the account that just claimed.
        await tx.eventPlayer.updateMany({
          where: { eventId, name: oldName, userId: null },
          data: { userId, name: userName },
        });
      } else {
        const claimed = await tx.eventPlayer.updateMany({
          where: { id: playerId, eventId, userId: null },
          data: { userId, name: userName },
        });
        if (claimed.count === 0) throw new Error("CLAIM_RACE");
      }

      await tx.teamMember.updateMany({
        where: { name: oldName, team: { eventId } },
        data: { name: userName },
      });

      const anonRating = await tx.playerRating.findUnique({
        where: { eventId_name: { eventId, name: oldName } },
      });
      // A rating row with gamesPlayed carries settled results; moving it would
      // rewrite an ELO history that already happened.
      if (anonRating && anonRating.gamesPlayed === 0) {
        await tx.playerRating.update({
          where: { id: anonRating.id },
          data: { name: userName, userId },
        });
      }

      const histories = await tx.gameHistory.findMany({
        where: { eventId },
        select: { id: true, teamsSnapshot: true, status: true, scoreOne: true, scoreTwo: true },
      });
      for (const h of histories) {
        if (!h.teamsSnapshot || !h.teamsSnapshot.includes(oldName)) continue;
        // A scored or cancelled game is settled history: a claim must never
        // rename a participant in a game that already happened.
        if (h.status !== "played" || (h.scoreOne !== null && h.scoreTwo !== null)) continue;
        try {
          const teams: { team: string; players: { name: string; order: number }[] }[] = JSON.parse(h.teamsSnapshot);
          let changed = false;
          for (const team of teams) {
            for (const p of team.players) {
              if (p.name === oldName) {
                p.name = userName;
                changed = true;
              }
            }
          }
          if (changed) {
            await tx.gameHistory.update({
              where: { id: h.id },
              data: { teamsSnapshot: JSON.stringify(teams) },
            });
          }
        } catch { /* malformed JSON — skip */ }
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "CLAIM_RACE") {
      throw new Error("This player was already claimed by someone else.", { cause: err });
    }
    throw err;
  }

  await prisma.eventFollow.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId },
    update: {},
  });
  enqueuePushSetupHintSafe(userId, eventId);

  return {
    ok: true,
    claimedPlayerId: target?.id ?? playerId,
  };
}
