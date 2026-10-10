import { prisma } from "./db.server";
import { activeParticipantsWhere } from "./activeParticipants.server";
import { getDefaultFormation } from "./formations";
import { reconcileFormations } from "./teamFormation.server";
import { syncGamePayments } from "./settlement.server";
import { syncGameFromTeamResults } from "./gameDualWrite.server";

export interface TeamAssignmentInput {
  teamOnePlayerIds: string[];
  teamTwoPlayerIds: string[];
}

export interface TeamAssignmentResult {
  ok: true;
  teamOne: { id: string; name: string; members: { name: string; order: number; slot: number | null }[] };
  teamTwo: { id: string; name: string; members: { name: string; order: number; slot: number | null }[] };
}

export async function dualWriteCurrentGameTeams(currentGameId: string | null, eventId: string) {
  if (!currentGameId) return;
  const game = await prisma.game.findUnique({ where: { id: currentGameId } });
  if (game) {
    const teamResults = await prisma.teamResult.findMany({
      where: { eventId },
      include: { members: { orderBy: { order: "asc" } } },
      orderBy: { id: "asc" },
    });
    await syncGameFromTeamResults(game, teamResults);
  }
  await syncGamePayments(currentGameId, eventId);
}

export async function getActivePlayers(eventId: string, currentGameId: string | null) {
  if (currentGameId) {
    const participants = await prisma.gameParticipant.findMany({
      where: activeParticipantsWhere(currentGameId),
      include: { eventPlayer: { select: { id: true, name: true, userId: true } } },
      orderBy: { order: "asc" },
    });
    return participants.map((gp) => ({
      id: gp.eventPlayer.id,
      name: gp.eventPlayer.name,
      order: gp.order,
      userId: gp.eventPlayer.userId,
    }));
  }
  const players = await prisma.player.findMany({
    where: { eventId, archivedAt: null },
    orderBy: { order: "asc" },
  });
  return players.map((p) => ({ id: p.id, name: p.name, order: p.order, userId: p.userId }));
}

export async function assignTeams(
  eventId: string,
  input: TeamAssignmentInput,
  maxPlayers: number,
  currentGameId: string | null,
  sport: string,
): Promise<TeamAssignmentResult> {
  const allPlayers = await getActivePlayers(eventId, currentGameId);
  const allPlayerIds = new Set(allPlayers.map((p) => p.id));
  const requestedIds = [...input.teamOnePlayerIds, ...input.teamTwoPlayerIds];

  for (const id of requestedIds) {
    if (!allPlayerIds.has(id)) {
      throw new Error(`Player ${id} not found in event`);
    }
  }

  const idSet = new Set(requestedIds);
  if (idSet.size !== requestedIds.length) {
    throw new Error("Duplicate player IDs");
  }

  const activePlayerIds = new Set(
    allPlayers.slice(0, maxPlayers).map((p) => p.id),
  );
  for (const id of requestedIds) {
    if (!activePlayerIds.has(id)) {
      throw new Error(`Player ${id} is on the bench and cannot be assigned to a team`);
    }
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { teamResults: true },
  });
  if (!event) throw new Error("Event not found");

  // One transaction for the whole save: members are written unplaced and laid
  // out by the reconcile at the end, so committing them separately would leave
  // every member of the event "Not placed" if anything failed in between — and
  // nothing else would fix it until some later membership write.
  await prisma.$transaction(async (tx) => {
    if (event.teamResults.length < 2) {
      await tx.teamResult.deleteMany({ where: { eventId } });
      await tx.teamResult.createMany({
        data: [
          { name: event.teamOneName || "Team 1", eventId, formation: getDefaultFormation(sport).id },
          { name: event.teamTwoName || "Team 2", eventId, formation: getDefaultFormation(sport).id },
        ],
      });
    }

    const teams = await tx.teamResult.findMany({
      where: { eventId },
      orderBy: { id: "asc" },
    });

    await tx.teamMember.deleteMany({
      where: { teamResultId: { in: teams.map((t) => t.id) } },
    });

    const teamOne = teams[0];
    const teamTwo = teams[1];

    // Slots belong to the formation each team stores, not to the sport's
    // default: members are written unplaced and the reconcile below lays them
    // onto it. Deriving them from `getDefaultFormation(sport)` here wrote a
    // member `slot: null` whenever the default was narrower than the drawn team.
    const memberCreates: { name: string; order: number; slot: number | null; teamResultId: string }[] = [];
    const playerLookup = new Map(allPlayers.map((p) => [p.id, p.name]));

    for (let i = 0; i < input.teamOnePlayerIds.length; i++) {
      const name = playerLookup.get(input.teamOnePlayerIds[i]);
      if (name) {
        memberCreates.push({ name, order: i, slot: null, teamResultId: teamOne.id });
      }
    }

    for (let i = 0; i < input.teamTwoPlayerIds.length; i++) {
      const name = playerLookup.get(input.teamTwoPlayerIds[i]);
      if (name) {
        memberCreates.push({ name, order: i, slot: null, teamResultId: teamTwo.id });
      }
    }

    if (memberCreates.length > 0) {
      await tx.teamMember.createMany({ data: memberCreates });
    }

    // Re-derive both teams' layouts from the saved split: a stored formation is
    // only defaulted when it does not resolve for the sport, so the organiser's
    // choice outlives a save and nobody is left outside the formation they see.
    // It reads and writes through this transaction — its reads have to see the
    // members just written, and its writes have to commit with them.
    await reconcileFormations(eventId, sport, tx);
  });

  await dualWriteCurrentGameTeams(currentGameId, eventId);

  const updatedEvent = await prisma.event.findUnique({
    where: { id: eventId },
    include: { teamResults: { include: { members: { orderBy: { order: "asc" } } } } },
  });
  if (!updatedEvent) throw new Error("Event not found");

  const updatedPlayers = await getActivePlayers(eventId, currentGameId);
  const activeUpdated = updatedPlayers.slice(0, updatedEvent.maxPlayers);

  const updatedMemberLookup = new Map<string, string>();
  for (const team of updatedEvent.teamResults) {
    for (const member of team.members) {
      updatedMemberLookup.set(member.name, team.id);
    }
  }

  const t1Id = updatedEvent.teamResults[0]?.id;
  const t2Id = updatedEvent.teamResults[1]?.id;

  return {
    ok: true,
    teamOne: {
      id: t1Id ?? "",
      name: updatedEvent.teamOneName || "Team 1",
      members: activeUpdated
        .filter((p) => t1Id && updatedMemberLookup.get(p.name) === t1Id)
        .map((p) => ({ name: p.name, order: p.order, slot: null })),
    },
    teamTwo: {
      id: t2Id ?? "",
      name: updatedEvent.teamTwoName || "Team 2",
      members: activeUpdated
        .filter((p) => t2Id && updatedMemberLookup.get(p.name) === t2Id)
        .map((p) => ({ name: p.name, order: p.order, slot: null })),
    },
  };
}
