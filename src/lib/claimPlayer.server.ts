import type { Player } from "@prisma/client";
import { prisma } from "./db.server";
import { enqueuePushSetupHintSafe } from "./pushSetupHint";

export interface ClaimPlayerInput {
  playerId: string;
  userId: string;
  userName: string;
}

export interface ClaimPlayerResult {
  ok: true;
  claimedPlayerId: string;
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

  const oldName: string = target?.name ?? guestEp?.name ?? "";

  try {
    await prisma.$transaction(async (tx) => {
      if (target) {
        const claimed = await tx.player.updateMany({
          where: { id: target.id, eventId, userId: null },
          data: { userId, name: userName },
        });
        if (claimed.count === 0) throw new Error("CLAIM_RACE");
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
      if (anonRating) {
        await tx.playerRating.update({
          where: { id: anonRating.id },
          data: { name: userName, userId },
        });
      }

      const histories = await tx.gameHistory.findMany({
        where: { eventId },
        select: { id: true, teamsSnapshot: true },
      });
      for (const h of histories) {
        if (!h.teamsSnapshot || !h.teamsSnapshot.includes(oldName)) continue;
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
