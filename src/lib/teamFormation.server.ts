/**
 * Team formation — validate, add and remove players on the generated match
 * lineups, keeping teams balanced. Extracted from the players route so the
 * route, the leave flow and the MCP tools share one implementation instead of
 * importing from an API route.
 */
import { prisma } from "./db.server";
import { getActiveRosterState } from "./roster.server";
import { balanceTeams } from "./elo.server";

/**
 * Validate that all team members are active players (order < maxPlayers).
 * Removes any invalid members from teams rather than clearing all teams.
 * Returns true if any members were removed.
 */
export async function validateTeams(eventId: string, maxPlayers: number, currentGameId?: string | null): Promise<boolean> {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length === 0) return false;

  const activeNames = (await getActiveRosterState(eventId, maxPlayers, currentGameId)).activeNames;

  const idsToRemove: string[] = [];
  for (const team of teams) {
    for (const member of team.members) {
      if (!activeNames.has(member.name)) {
        idsToRemove.push(member.id);
      }
    }
  }

  if (idsToRemove.length > 0) {
    await prisma.teamMember.deleteMany({ where: { id: { in: idsToRemove } } });
    return true;
  }
  return false;
}

/**
 * If teams have been generated, add a player to the appropriate team.
 * When the event has balanced=true, triggers a full rebalance (minimum swaps).
 * Otherwise, adds to the team with fewer players.
 */
export async function addPlayerToTeams(eventId: string, playerName: string, currentGameId?: string | null) {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length === 0) return; // no teams generated yet

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { balanced: true, maxPlayers: true, teamOneName: true, teamTwoName: true, currentGameId: true } });
  const gameId = currentGameId ?? event?.currentGameId;

  if (event?.balanced && teams.length === 2) {
    // Full rebalance: include all current members + new player
    const activeNames = (await getActiveRosterState(eventId, event.maxPlayers, gameId)).activeNames;
    // Only rebalance if new player is in active range
    if (activeNames.has(playerName)) {
      const ratings = await prisma.playerRating.findMany({ where: { eventId } });
      const ratingMap = new Map(ratings.map((r) => [r.name, r.rating]));
      const playersWithRatings = [...activeNames].map((name) => ({
        name,
        rating: ratingMap.get(name) ?? 1000,
      }));
      const newMatches = balanceTeams(playersWithRatings, [event.teamOneName, event.teamTwoName]);

      await prisma.$transaction([
        prisma.teamMember.deleteMany({ where: { teamResultId: { in: teams.map(t => t.id) } } }),
        ...newMatches.flatMap((match) => {
          const teamId = teams.find(t => t.name === match.team)?.id;
          if (!teamId) return [];
          return match.players.map((p) =>
            prisma.teamMember.create({ data: { name: p.name, order: p.order, teamResultId: teamId } })
          );
        }),
      ]);
      return;
    }
  }

  // Non-balanced: just add to smaller team
  const sorted = [...teams].sort((a, b) => a.members.length - b.members.length);
  const target = sorted[0];

  await prisma.teamMember.create({
    data: {
      name: playerName,
      order: target.members.length,
      teamResultId: target.id,
    },
  });
}

/**
 * If teams have been generated, remove a player from their team.
 * If a promoted bench player name is given, slot them into the same team.
 * When the event has balanced=true, triggers a full rebalance instead of a single swap.
 */
export async function removePlayerFromTeams(eventId: string, playerName: string, promotedName?: string, currentGameId?: string | null) {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length === 0) return;

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { balanced: true, maxPlayers: true, teamOneName: true, teamTwoName: true, currentGameId: true } });
  const gameId = currentGameId ?? event?.currentGameId;

  // Balanced mode: full rebalance with current active players (excluding the leaving one, including promoted)
  if (event?.balanced && teams.length === 2) {
    const activeNames = [...(await getActiveRosterState(eventId, event.maxPlayers, gameId)).activeNames].filter(n => n !== playerName);
    if (promotedName && !activeNames.includes(promotedName)) {
      activeNames.push(promotedName);
    }

    if (activeNames.length >= 2) {
      const ratings = await prisma.playerRating.findMany({ where: { eventId } });
      const ratingMap = new Map(ratings.map((r) => [r.name, r.rating]));
      const playersWithRatings = activeNames.map((name) => ({
        name,
        rating: ratingMap.get(name) ?? 1000,
      }));
      const newMatches = balanceTeams(playersWithRatings, [event.teamOneName, event.teamTwoName]);

      await prisma.$transaction([
        prisma.teamMember.deleteMany({ where: { teamResultId: { in: teams.map(t => t.id) } } }),
        ...newMatches.flatMap((match) => {
          const teamId = teams.find(t => t.name === match.team)?.id;
          if (!teamId) return [];
          return match.players.map((p) =>
            prisma.teamMember.create({ data: { name: p.name, order: p.order, teamResultId: teamId } })
          );
        }),
      ]);
      return;
    }
  }

  // Non-balanced: manual remove + optional promote
  let promotedTeamId: string | null = null;

  for (const team of teams) {
    const member = team.members.find((m) => m.name === playerName);
    if (!member) continue;

    await prisma.teamMember.delete({ where: { id: member.id } });

    const remaining = team.members
      .filter((m) => m.id !== member.id)
      .sort((a, b) => a.order - b.order);
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].order !== i) {
        await prisma.teamMember.update({ where: { id: remaining[i].id }, data: { order: i } });
      }
    }

    if (promotedName) {
      await prisma.teamMember.create({
        data: {
          name: promotedName,
          order: remaining.length,
          teamResultId: team.id,
        },
      });
      promotedTeamId = team.id;
    }

    break;
  }

  // Non-balanced: try single swap for minor improvement
  if (promotedName && promotedTeamId) {
    const eventCheck = await prisma.event.findUnique({ where: { id: eventId }, select: { balanced: true } });
    if (eventCheck?.balanced) {
      await tryBalancedSwap(eventId, promotedName, promotedTeamId);
    }
  }
}

/**
 * After a promoted player is placed on a team, check if swapping them
 * with a player on the other team would improve ELO balance.
 * Only performs the swap if it strictly reduces the gap — at most 1 swap.
 */
async function tryBalancedSwap(eventId: string, promotedName: string, promotedTeamId: string) {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length !== 2) return;

  const promotedTeam = teams.find(t => t.id === promotedTeamId);
  const otherTeam = teams.find(t => t.id !== promotedTeamId);
  if (!promotedTeam || !otherTeam) return;

  // Get ELO ratings
  const ratings = await prisma.playerRating.findMany({ where: { eventId } });
  const ratingMap = new Map(ratings.map(r => [r.name, r.rating]));
  const getRating = (name: string) => ratingMap.get(name) ?? 1000;

  const promotedRating = getRating(promotedName);

  // Current team totals
  const promotedTeamTotal = promotedTeam.members.reduce((sum, m) => sum + getRating(m.name), 0);
  const otherTeamTotal = otherTeam.members.reduce((sum, m) => sum + getRating(m.name), 0);
  const currentGap = Math.abs(promotedTeamTotal - otherTeamTotal);

  // Try swapping promoted player with each player on the other team
  let bestSwap: { otherMember: typeof otherTeam.members[0]; newGap: number } | null = null;

  for (const otherMember of otherTeam.members) {
    const otherRating = getRating(otherMember.name);
    // After swap: promoted goes to other team, otherMember goes to promoted team
    const newPromotedTeamTotal = promotedTeamTotal - promotedRating + otherRating;
    const newOtherTeamTotal = otherTeamTotal - otherRating + promotedRating;
    const newGap = Math.abs(newPromotedTeamTotal - newOtherTeamTotal);

    if (newGap < currentGap && (!bestSwap || newGap < bestSwap.newGap)) {
      bestSwap = { otherMember, newGap };
    }
  }

  if (!bestSwap) return; // No swap improves balance

  // Perform the swap
  const promotedMember = promotedTeam.members.find(m => m.name === promotedName);
  if (!promotedMember) return;
  const swapTarget = bestSwap.otherMember;

  // Move promoted player to other team
  await prisma.teamMember.update({
    where: { id: promotedMember.id },
    data: { teamResultId: otherTeam.id, order: swapTarget.order },
  });

  // Move swap target to promoted team
  await prisma.teamMember.update({
    where: { id: swapTarget.id },
    data: { teamResultId: promotedTeam.id, order: promotedMember.order },
  });
}
