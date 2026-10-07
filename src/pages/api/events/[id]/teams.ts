import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { authenticateRequest } from "../../../../lib/authenticate.server";
import { checkOwnership, getSession } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { applyFormationLayout } from "../../../../lib/teams";
import { assignTeams, getActivePlayers, dualWriteCurrentGameTeams } from "../../../../lib/teamAssignment.server";


/**
 * GET /api/events/[id]/teams
 * Returns the current teams and player assignments for an event.
 *
 * PATCH /api/events/[id]/teams
 * Updates team assignments by reassigning players between teams.
 * Body: { teamOnePlayerIds: string[], teamTwoPlayerIds: string[] }
 */

export const GET: APIRoute = async ({ params, request }) => {
	const limited = await rateLimitResponse(request, "read");
	if (limited) return limited;

	if (!params.id) return Response.json({ error: "Missing event id" }, { status: 400 });

	const event = await prisma.event.findUnique({
		where: { id: params.id },
		include: {
			teamResults: { include: { members: { orderBy: { order: "asc" } } } },
		},
	});

	if (!event) return Response.json({ error: "Not found." }, { status: 404 });

	const allPlayers = await getActivePlayers(params.id, event.currentGameId);
	const maxPlayers = event.maxPlayers;

	// Active players are the first N by position
	const activePlayers = allPlayers.slice(0, maxPlayers);
	const benchPlayers = allPlayers.slice(maxPlayers);

	// Build team member lookup: playerId -> teamResult id
	const memberLookup = new Map<string, string>(); // playerName -> teamResultId
	for (const team of event.teamResults) {
		for (const member of team.members) {
			memberLookup.set(member.name, team.id);
		}
	}

	// Build team assignments
	const teamOneId = event.teamResults.length >= 1 ? event.teamResults[0].id : null;
	const teamTwoId = event.teamResults.length >= 2 ? event.teamResults[1].id : null;

	const teamOnePlayers = activePlayers.filter(
		(p) => teamOneId && memberLookup.get(p.name) === teamOneId,
	);
	const teamTwoPlayers = activePlayers.filter(
		(p) => teamTwoId && memberLookup.get(p.name) === teamTwoId,
	);
	// Players not assigned to any team
	const unassignedActive = activePlayers.filter(
		(p) => !memberLookup.has(p.name),
	);

	return Response.json({
		teamOne: {
			name: event.teamOneName || "Team 1",
			players: teamOnePlayers.map((p) => ({
				id: p.id,
				name: p.name,
				order: p.order,
			})),
		},
		teamTwo: {
			name: event.teamTwoName || "Team 2",
			players: teamTwoPlayers.map((p) => ({
				id: p.id,
				name: p.name,
				order: p.order,
			})),
		},
		unassigned: unassignedActive.map((p) => ({
			id: p.id,
			name: p.name,
			order: p.order,
		})),
		bench: benchPlayers.map((p) => ({
			id: p.id,
			name: p.name,
			order: p.order,
		})),
		maxPlayers,
	});
};

/**
 * PUT /api/events/[id]/teams
 * Legacy endpoint that accepts { matches: [{ team, players }] }.
 * Maintained for backward compatibility with existing API consumers.
 */
export const PUT: APIRoute = async ({ params, request }) => {
	const limited = await rateLimitResponse(request, "write");
	if (limited) return limited;

	if (!params.id) return Response.json({ error: "Missing event id" }, { status: 400 });

	const session = await getSession(request);
	if (!session?.user) {
		return Response.json({ error: "You must be logged in to update teams." }, { status: 401 });
	}

	const eventId = params.id;

	const event = await prisma.event.findUnique({
		where: { id: eventId },
	});

	if (!event) return Response.json({ error: "Not found." }, { status: 404 });

	const allPlayers = await getActivePlayers(eventId, event.currentGameId);

	const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
	const isPlayer = allPlayers.some((p) => p.userId === session.user.id);

	if (!isOwner && !isAdmin && !isPlayer) {
		return Response.json({ error: "You must be the event owner, an admin, or a player in this game to update teams." }, { status: 403 });
	}

	interface MatchInput {
		team: string;
		formation?: string | null;
		players: { name: string; order: number; slot?: number | null }[];
	}
	let body: { matches: MatchInput[] };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	if (!Array.isArray(body.matches)) {
		return Response.json({ error: "matches must be an array" }, { status: 400 });
	}

	// Validate that all player names in matches are active players (first N by position)
	const activePlayers = allPlayers.slice(0, event.maxPlayers);
	const activeNames = new Set(activePlayers.map((p) => p.name));

	for (const match of body.matches) {
		for (const player of match.players) {
			if (!activeNames.has(player.name)) {
				return Response.json({ error: `Player ${player.name} is not an active player or is on the bench` }, { status: 400 });
			}
		}
	}

	// Delete existing teams and recreate
	await prisma.teamResult.deleteMany({ where: { eventId: event.id } });

	const laidOut = applyFormationLayout(body.matches, event.sport);
	for (const match of laidOut) {
		await prisma.teamResult.create({
			data: {
				name: match.team,
				formation: match.formation ?? null,
				eventId: event.id,
				members: {
					create: match.players.map((p) => ({ name: p.name, order: p.order, slot: p.slot ?? null })),
				},
			},
		});
	}

	// Keep payment rows aligned with the new lineup: only lineup players owe.
	await dualWriteCurrentGameTeams(event.currentGameId, eventId);

	return Response.json({ ok: true });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  if (!params.id) return Response.json({ error: "Missing event id" }, { status: 400 });

  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!auth.scopes.includes("write:events") && !auth.scopes.includes("manage:players")) {
    return Response.json({ error: "Forbidden: insufficient scope" }, { status: 403 });
  }

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      teamResults: { include: { members: true } },
    },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Check ownership or admin
  const isOwner = event.ownerId === auth.userId;
  const isAdmin = auth.userId
    ? (await prisma.eventAdmin.findFirst({
        where: { eventId: event.id, userId: auth.userId },
      })) !== null
    : false;

  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Forbidden: only the owner or admin can update teams" }, { status: 403 });
  }

  let body: { teamOnePlayerIds?: string[]; teamTwoPlayerIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const teamOnePlayerIds: string[] = body.teamOnePlayerIds ?? [];
  const teamTwoPlayerIds: string[] = body.teamTwoPlayerIds ?? [];
  if (!Array.isArray(teamOnePlayerIds) || !Array.isArray(teamTwoPlayerIds)) {
    return Response.json({ error: "teamOnePlayerIds and teamTwoPlayerIds must be arrays" }, { status: 400 });
  }

  try {
    await assignTeams(
      event.id,
      { teamOnePlayerIds, teamTwoPlayerIds },
      event.maxPlayers,
      event.currentGameId,
      event.sport,
    );

    const updatedEvent = await prisma.event.findUnique({
      where: { id: event.id },
      include: {
        teamResults: { include: { members: { orderBy: { order: "asc" } } } },
      },
    });
    if (!updatedEvent) return Response.json({ error: "Not found." }, { status: 404 });

    const updatedPlayers = await getActivePlayers(event.id, event.currentGameId);
    const activeUpdated = updatedPlayers.slice(0, updatedEvent.maxPlayers);
    const benchUpdated = updatedPlayers.slice(updatedEvent.maxPlayers);

    const updatedMemberLookup = new Map<string, string>();
    for (const team of updatedEvent.teamResults) {
      for (const member of team.members) {
        updatedMemberLookup.set(member.name, team.id);
      }
    }

    const t1Id = updatedEvent.teamResults[0]?.id;
    const t2Id = updatedEvent.teamResults[1]?.id;

    return Response.json({
      teamOne: {
        name: updatedEvent.teamOneName || "Team 1",
        players: activeUpdated
          .filter((p) => t1Id && updatedMemberLookup.get(p.name) === t1Id)
          .map((p) => ({ id: p.id, name: p.name, order: p.order })),
      },
      teamTwo: {
        name: updatedEvent.teamTwoName || "Team 2",
        players: activeUpdated
          .filter((p) => t2Id && updatedMemberLookup.get(p.name) === t2Id)
          .map((p) => ({ id: p.id, name: p.name, order: p.order })),
      },
      unassigned: activeUpdated
        .filter((p) => !updatedMemberLookup.has(p.name))
        .map((p) => ({ id: p.id, name: p.name, order: p.order })),
      bench: benchUpdated.map((p) => ({ id: p.id, name: p.name, order: p.order })),
      maxPlayers: updatedEvent.maxPlayers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found")) {
      return Response.json({ error: message }, { status: 400 });
    }
    if (message.includes("Duplicate")) {
      return Response.json({ error: message }, { status: 400 });
    }
    if (message.includes("bench")) {
      return Response.json({ error: message }, { status: 400 });
    }
    throw err;
  }
};