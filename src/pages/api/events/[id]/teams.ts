import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { authenticateRequest } from "../../../../lib/authenticate.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import type { Imatch } from "../../../../lib/random";

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
			players: { where: { archivedAt: null }, orderBy: { order: "asc" } },
			teamResults: { include: { members: { orderBy: { order: "asc" } } } },
		},
	});

	if (!event) return Response.json({ error: "Not found." }, { status: 404 });

	const maxPlayers = event.maxPlayers;

	// Active players (order < maxPlayers) vs bench
	const activePlayers = event.players.filter((p) => p.order < maxPlayers);
	const benchPlayers = event.players.filter((p) => p.order >= maxPlayers);

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

	const eventId = params.id;

	const event = await prisma.event.findUnique({
		where: { id: eventId },
		include: {
			players: { where: { archivedAt: null }, orderBy: { order: "asc" } },
		},
	});

	if (!event) return Response.json({ error: "Not found." }, { status: 404 });

	interface MatchInput { team: string; players: { name: string; order: number }[] }
	let body: { matches: MatchInput[] };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	if (!Array.isArray(body.matches)) {
		return Response.json({ error: "matches must be an array" }, { status: 400 });
	}

	// Validate that all player names in matches are active players
	const activePlayers = event.players.filter((p) => p.order < event.maxPlayers);
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

	for (const match of body.matches) {
		const teamResult = await prisma.teamResult.create({
			data: {
				name: match.team,
				eventId: event.id,
				members: {
					create: match.players.map((p) => ({ name: p.name, order: p.order })),
				},
			},
		});
	}

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
			players: { where: { archivedAt: null }, orderBy: { order: "asc" } },
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

	// Validate all player IDs belong to this event
	const allPlayerIds = new Set(event.players.map((p) => p.id));
	const requestedIds = [...teamOnePlayerIds, ...teamTwoPlayerIds];
	for (const id of requestedIds) {
		if (!allPlayerIds.has(id)) {
			return Response.json({ error: `Player ${id} not found in event` }, { status: 400 });
		}
	}

	// Validate no duplicates
	const idSet = new Set(requestedIds);
	if (idSet.size !== requestedIds.length) {
		return Response.json({ error: "Duplicate player IDs" }, { status: 400 });
	}

	// Only allow active players (order < maxPlayers) to be on teams
	const activePlayerIds = new Set(
		event.players.filter((p) => p.order < event.maxPlayers).map((p) => p.id),
	);
	for (const id of requestedIds) {
		if (!activePlayerIds.has(id)) {
			return Response.json({ error: `Player ${id} is on the bench and cannot be assigned to a team` }, { status: 400 });
		}
	}

	// Ensure we have exactly 2 team results; create them if needed
	if (event.teamResults.length < 2) {
		// Delete existing team results and create fresh ones
		await prisma.teamResult.deleteMany({ where: { eventId: event.id } });
		await prisma.teamResult.createMany({
			data: [
				{ name: event.teamOneName || "Team 1", eventId: event.id },
				{ name: event.teamTwoName || "Team 2", eventId: event.id },
			],
		});
	}

	// Fetch fresh team results
	const teams = await prisma.teamResult.findMany({
		where: { eventId: event.id },
		orderBy: { id: "asc" },
	});

	// Clear all existing team members
	await prisma.teamMember.deleteMany({
		where: { teamResultId: { in: teams.map((t) => t.id) } },
	});

	// Assign players to teams
	const teamOne = teams[0];
	const teamTwo = teams[1];

	const memberCreates: { name: string; order: number; teamResultId: string }[] = [];
	const playerLookup = new Map(event.players.map((p) => [p.id, p.name]));

	for (let i = 0; i < teamOnePlayerIds.length; i++) {
		const name = playerLookup.get(teamOnePlayerIds[i]);
		if (name) {
			memberCreates.push({ name, order: i, teamResultId: teamOne.id });
		}
	}

	for (let i = 0; i < teamTwoPlayerIds.length; i++) {
		const name = playerLookup.get(teamTwoPlayerIds[i]);
		if (name) {
			memberCreates.push({ name, order: i, teamResultId: teamTwo.id });
		}
	}

	if (memberCreates.length > 0) {
		await prisma.teamMember.createMany({ data: memberCreates });
	}

	// Return updated teams
	const updatedEvent = await prisma.event.findUnique({
		where: { id: event.id },
		include: {
			players: { where: { archivedAt: null }, orderBy: { order: "asc" } },
			teamResults: { include: { members: { orderBy: { order: "asc" } } } },
		},
	});

	const activeUpdated = updatedEvent!.players.slice(0, updatedEvent!.maxPlayers);
	const benchUpdated = updatedEvent!.players.slice(updatedEvent!.maxPlayers);

	const updatedMemberLookup = new Map<string, string>();
	for (const team of updatedEvent!.teamResults) {
		for (const member of team.members) {
			updatedMemberLookup.set(member.name, team.id);
		}
	}

	const t1Id = updatedEvent!.teamResults[0]?.id;
	const t2Id = updatedEvent!.teamResults[1]?.id;

	return Response.json({
		teamOne: {
			name: updatedEvent!.teamOneName || "Team 1",
			players: activeUpdated
				.filter((p) => t1Id && updatedMemberLookup.get(p.name) === t1Id)
				.map((p) => ({ id: p.id, name: p.name, order: p.order })),
		},
		teamTwo: {
			name: updatedEvent!.teamTwoName || "Team 2",
			players: activeUpdated
				.filter((p) => t2Id && updatedMemberLookup.get(p.name) === t2Id)
				.map((p) => ({ id: p.id, name: p.name, order: p.order })),
		},
		unassigned: activeUpdated
			.filter((p) => !updatedMemberLookup.has(p.name))
			.map((p) => ({ id: p.id, name: p.name, order: p.order })),
		bench: benchUpdated.map((p) => ({ id: p.id, name: p.name, order: p.order })),
		maxPlayers: updatedEvent!.maxPlayers,
	});
};