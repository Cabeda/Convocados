/** ADR 0016 ordering helpers — the UI renders GameParticipant.order (per-game),
 *  so every Player-side reorder must be mirrored onto the current game's
 *  GameParticipant rows or the change is invisible. */

import { Prisma } from "@prisma/client";
import { prisma } from "./db.server";

/** Mirror a name-ordered list onto the GameParticipant rows of a game.
 *  Active participants whose EventPlayer name is not in `orderedNames` (e.g. a
 *  player who left the event roster but still has a live participant row) are
 *  appended after the matched ones, keeping their relative order — otherwise
 *  their stale order would collide with the fresh 0..n sequence. */
export async function syncGameParticipantOrder(
  eventId: string,
  gameId: string,
  orderedNames: string[],
) {
  const eps = await prisma.eventPlayer.findMany({
    where: { eventId, name: { in: orderedNames } },
    select: { id: true, name: true },
  });
  const epByName = new Map(eps.map((e) => [e.name, e.id]));
  const matchedEpIds = new Set(
    orderedNames.map((n) => epByName.get(n)).filter((id): id is string => !!id),
  );

  const ops: Prisma.PrismaPromise<unknown>[] = orderedNames.flatMap((name, i) => {
    const epId = epByName.get(name);
    return epId
      ? [prisma.gameParticipant.updateMany({
          where: { gameId, eventPlayerId: epId, archivedAt: null },
          data: { order: i },
        })]
      : [];
  });

  const unmatched = await prisma.gameParticipant.findMany({
    where: { gameId, archivedAt: null, eventPlayerId: { notIn: [...matchedEpIds] } },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  ops.push(
    ...unmatched.map((gp, j) =>
      prisma.gameParticipant.update({ where: { id: gp.id }, data: { order: orderedNames.length + j } })
    ),
  );

  await prisma.$transaction(ops);
}
