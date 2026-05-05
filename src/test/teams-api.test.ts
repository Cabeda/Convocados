import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET, PATCH, PUT } from "~/pages/api/events/[id]/teams";

function getContext(params: Record<string, string>, method: string, body?: unknown, headers: Record<string, string> = {}) {
	const url = `http://localhost/api/events/${params.id}/teams`;
	return {
		params,
		request: new Request(url, {
			method,
			headers: { "content-type": "application/json", ...headers },
			body: body ? JSON.stringify(body) : undefined,
		}),
		url: new URL(url),
	} as any;
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
	return prisma.event.create({
		data: {
			title: "Test Game",
			location: "Pitch A",
			dateTime: new Date(Date.now() + 3600_000),
			sport: "Soccer",
			maxPlayers: 5,
			durationMinutes: 60,
			teamOneName: "Red",
			teamTwoName: "Blue",
			...overrides,
		},
	});
}

async function seedUser(overrides: Record<string, unknown> = {}) {
	const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	return prisma.user.create({
		data: {
			id,
			name: (overrides.name as string) ?? "Test User",
			email: (overrides.email as string) ?? `${id}@test.com`,
			emailVerified: true,
		},
	});
}

const OAUTH_CLIENT_ID = "teams-test-client";

async function seedOAuthApp() {
	await prisma.oauthApplication.upsert({
		where: { clientId: OAUTH_CLIENT_ID },
		create: {
			name: "Teams Test Client",
			clientId: OAUTH_CLIENT_ID,
			redirectUrls: "[]",
			type: "web",
		},
		update: {},
	});
}

async function seedOAuthToken(userId: string, scopes = "write:events manage:players") {
	const accessToken = "test-team-token-" + Math.random().toString(36).slice(2);
	await prisma.oauthAccessToken.create({
		data: {
			accessToken,
			refreshToken: "test-team-refresh-" + Math.random().toString(36).slice(2),
			accessTokenExpiresAt: new Date(Date.now() + 3600_000),
			refreshTokenExpiresAt: new Date(Date.now() + 86400_000),
			userId,
			clientId: OAUTH_CLIENT_ID,
			scopes,
		},
	});
	return accessToken;
}

// ── GET /api/events/[id]/teams ─────────────────────────────────────────────

describe("GET /api/events/[id]/teams", () => {
	beforeEach(async () => {
		resetApiRateLimitStore();
		await prisma.teamMember.deleteMany();
		await prisma.teamResult.deleteMany();
		await prisma.player.deleteMany();
		await prisma.event.deleteMany();
		await prisma.user.deleteMany();
	});

	it("returns empty teams for an event with no players", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id });

		const res = await GET(getContext({ id: event.id }, "GET"));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.players).toHaveLength(0);
		expect(body.teamTwo.players).toHaveLength(0);
		expect(body.unassigned).toHaveLength(0);
		expect(body.bench).toHaveLength(0);
		expect(body.maxPlayers).toBe(5);
	});

	it("returns team names from the event", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id, teamOneName: "Eagles", teamTwoName: "Hawks" });

		const res = await GET(getContext({ id: event.id }, "GET"));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.name).toBe("Eagles");
		expect(body.teamTwo.name).toBe("Hawks");
	});

	it("returns default team names when event has none", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id, teamOneName: "", teamTwoName: "" });

		const res = await GET(getContext({ id: event.id }, "GET"));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.name).toBe("Team 1");
		expect(body.teamTwo.name).toBe("Team 2");
	});

	it("returns players assigned to teams", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id });
		await prisma.player.createMany({
			data: [
				{ name: "Alice", eventId: event.id, order: 0 },
				{ name: "Bob", eventId: event.id, order: 1 },
				{ name: "Charlie", eventId: event.id, order: 2 },
			],
		});
		const t1 = await prisma.teamResult.create({ data: { name: "Red", eventId: event.id } });
		const t2 = await prisma.teamResult.create({ data: { name: "Blue", eventId: event.id } });
		await prisma.teamMember.createMany({
			data: [
				{ name: "Alice", order: 0, teamResultId: t1.id },
				{ name: "Charlie", order: 1, teamResultId: t1.id },
				{ name: "Bob", order: 0, teamResultId: t2.id },
			],
		});

		const res = await GET(getContext({ id: event.id }, "GET"));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.name).toBe("Red");
		expect(body.teamOne.players).toHaveLength(2);
		expect(body.teamOne.players[0].name).toBe("Alice");
		expect(body.teamOne.players[1].name).toBe("Charlie");
		expect(body.teamTwo.name).toBe("Blue");
		expect(body.teamTwo.players).toHaveLength(1);
		expect(body.teamTwo.players[0].name).toBe("Bob");
	});

	it("returns unassigned players not on any team", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id });
		await prisma.player.createMany({
			data: [
				{ name: "Alice", eventId: event.id, order: 0 },
				{ name: "Bob", eventId: event.id, order: 1 },
				{ name: "Charlie", eventId: event.id, order: 2 },
			],
		});

		const t1 = await prisma.teamResult.create({ data: { name: "Red", eventId: event.id } });
		await prisma.teamMember.create({
			data: { name: "Alice", order: 0, teamResultId: t1.id },
		});

		const res = await GET(getContext({ id: event.id }, "GET"));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.players).toHaveLength(1);
		expect(body.unassigned).toHaveLength(2);
		expect(body.unassigned.map((p: any) => p.name)).toContain("Bob");
		expect(body.unassigned.map((p: any) => p.name)).toContain("Charlie");
	});

	it("returns bench players beyond maxPlayers", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id });
		for (let i = 0; i < 7; i++) {
			await prisma.player.create({ data: { name: `Player${i}`, eventId: event.id, order: i } });
		}

		const res = await GET(getContext({ id: event.id }, "GET"));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.unassigned).toHaveLength(5);
		expect(body.bench).toHaveLength(2);
		expect(body.bench.map((p: any) => p.name)).toContain("Player5");
		expect(body.bench.map((p: any) => p.name)).toContain("Player6");
	});

	it("returns player IDs in response", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id });
		const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
		const t1 = await prisma.teamResult.create({ data: { name: "Red", eventId: event.id } });
		await prisma.teamMember.create({ data: { name: "Alice", order: 0, teamResultId: t1.id } });

		const res = await GET(getContext({ id: event.id }, "GET"));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.players[0].id).toBe(p1.id);
		expect(typeof body.teamOne.players[0].order).toBe("number");
	});

	it("returns 404 for nonexistent event", async () => {
		const res = await GET(getContext({ id: "nonexistent" }, "GET"));
		expect(res.status).toBe(404);
	});

	it("returns 400 for missing event id", async () => {
		const res = await GET(getContext({ id: undefined as any }, "GET"));
		expect(res.status).toBe(400);
	});

	it("returns empty teams when no team results exist", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id });
		await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });

		const res = await GET(getContext({ id: event.id }, "GET"));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.unassigned).toHaveLength(1);
		expect(body.unassigned[0].name).toBe("Alice");
	});
});

// ── PATCH /api/events/[id]/teams ──────────────────────────────────────────

describe("PATCH /api/events/[id]/teams", () => {
	let accessToken: string;
	let owner: { id: string };
	let event: Awaited<ReturnType<typeof seedEvent>>;

	beforeEach(async () => {
		resetApiRateLimitStore();
		await prisma.teamMember.deleteMany();
		await prisma.teamResult.deleteMany();
		await prisma.player.deleteMany();
		await prisma.oauthAccessToken.deleteMany();
		await prisma.event.deleteMany();
		await prisma.user.deleteMany();
		await prisma.oauthApplication.deleteMany();

		await seedOAuthApp();
		owner = await seedUser();
		event = await seedEvent({ ownerId: owner.id });
		accessToken = await seedOAuthToken(owner.id);
	});

	it("assigns players to teams by ID", async () => {
		const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
		const p2 = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });
		await prisma.teamResult.create({ data: { name: "Red", eventId: event.id } });
		await prisma.teamResult.create({ data: { name: "Blue", eventId: event.id } });

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [p1.id],
			teamTwoPlayerIds: [p2.id],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.players).toHaveLength(1);
		expect(body.teamOne.players[0].name).toBe("Alice");
		expect(body.teamTwo.players).toHaveLength(1);
		expect(body.teamTwo.players[0].name).toBe("Bob");
	});

	it("assigns multiple players to each team", async () => {
		const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
		const p2 = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });
		const p3 = await prisma.player.create({ data: { name: "Charlie", eventId: event.id, order: 2 } });
		const p4 = await prisma.player.create({ data: { name: "Dana", eventId: event.id, order: 3 } });

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [p1.id, p3.id],
			teamTwoPlayerIds: [p2.id, p4.id],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.players).toHaveLength(2);
		expect(body.teamTwo.players).toHaveLength(2);
	});

	it("leaves players unassigned when not in either team", async () => {
		const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
		const p2 = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });
		const _p3 = await prisma.player.create({ data: { name: "Charlie", eventId: event.id, order: 2 } });
		await prisma.teamResult.create({ data: { name: "Red", eventId: event.id } });
		await prisma.teamResult.create({ data: { name: "Blue", eventId: event.id } });

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [p1.id],
			teamTwoPlayerIds: [p2.id],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.players).toHaveLength(1);
		expect(body.teamTwo.players).toHaveLength(1);
		expect(body.unassigned).toHaveLength(1);
		expect(body.unassigned[0].name).toBe("Charlie");
	});

	it("creates team results if they don't exist", async () => {
		const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
		const p2 = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [p1.id],
			teamTwoPlayerIds: [p2.id],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.players).toHaveLength(1);
		expect(body.teamTwo.players).toHaveLength(1);

		const teams = await prisma.teamResult.findMany({ where: { eventId: event.id } });
		expect(teams).toHaveLength(2);
	});

	it("replaces existing team assignments on PATCH", async () => {
		const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
		const p2 = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });
		await prisma.teamResult.create({ data: { name: "Red", eventId: event.id } });
		await prisma.teamResult.create({ data: { name: "Blue", eventId: event.id } });

		await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [p1.id],
			teamTwoPlayerIds: [p2.id],
		}, { authorization: `Bearer ${accessToken}` }));

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [p2.id],
			teamTwoPlayerIds: [p1.id],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.players[0].name).toBe("Bob");
		expect(body.teamTwo.players[0].name).toBe("Alice");
	});

	it("removes all players from teams when both arrays empty", async () => {
		const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
		await prisma.teamResult.create({ data: { name: "Red", eventId: event.id } });
		await prisma.teamResult.create({ data: { name: "Blue", eventId: event.id } });

		await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [p1.id],
			teamTwoPlayerIds: [],
		}, { authorization: `Bearer ${accessToken}` }));

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [],
			teamTwoPlayerIds: [],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.teamOne.players).toHaveLength(0);
		expect(body.teamTwo.players).toHaveLength(0);
		expect(body.unassigned).toHaveLength(1);
	});

	it("rejects unauthenticated requests", async () => {
		const res = await PATCH(getContext({ id: event.id }, "PATCH", {}));
		expect(res.status).toBe(401);
	});

	it("rejects requests with insufficient scope", async () => {
		const readOnlyToken = await seedOAuthToken(owner.id, "read:events");

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [],
			teamTwoPlayerIds: [],
		}, { authorization: `Bearer ${readOnlyToken}` }));

		expect(res.status).toBe(403);
	});

	it("rejects non-owner / non-admin from updating teams", async () => {
		const outsider = await seedUser({ name: "Outsider", email: "outsider@test.com" });
		const outsiderToken = await seedOAuthToken(outsider.id, "write:events");

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [],
			teamTwoPlayerIds: [],
		}, { authorization: `Bearer ${outsiderToken}` }));

		expect(res.status).toBe(403);
	});

	it("allows admins to update teams", async () => {
		const admin = await seedUser({ name: "Admin", email: "admin@test.com" });
		const adminToken = await seedOAuthToken(admin.id, "write:events manage:players");
		await prisma.eventAdmin.create({ data: { eventId: event.id, userId: admin.id } });

		const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [p1.id],
			teamTwoPlayerIds: [],
		}, { authorization: `Bearer ${adminToken}` }));

		expect(res.status).toBe(200);
	});

it("rejects bench players from team assignment", async () => {
		await prisma.event.update({ where: { id: event.id }, data: { maxPlayers: 2 } });
		// Create 3 players: 2 active + 1 bench (order >= maxPlayers)
		const _p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
		const _p2 = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 1 } });
		const benchPlayer = await prisma.player.create({ data: { name: "Carol", eventId: event.id, order: 2 } });
		await prisma.teamResult.create({ data: { name: "Red", eventId: event.id } });
		await prisma.teamResult.create({ data: { name: "Blue", eventId: event.id } });

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [benchPlayer.id],
			teamTwoPlayerIds: [],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain("bench");
	});

	it("rejects player IDs not belonging to event", async () => {
		const otherOwner = await seedUser({ name: "Other", email: "other@test.com" });
		const otherEvent = await seedEvent({ ownerId: otherOwner.id });
		const stranger = await prisma.player.create({ data: { name: "Stranger", eventId: otherEvent.id, order: 0 } });

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [stranger.id],
			teamTwoPlayerIds: [],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(400);
	});

	it("rejects duplicate player IDs", async () => {
		const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });

		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [p1.id, p1.id],
			teamTwoPlayerIds: [],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain("Duplicate");
	});

	it("rejects invalid JSON body", async () => {
		const ctx = {
			params: { id: event.id },
			request: new Request(`http://localhost/api/events/${event.id}/teams`, {
				method: "PATCH",
				headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
				body: "invalid json{{{",
			}),
			url: new URL(`http://localhost/api/events/${event.id}/teams`),
		} as any;

		const res = await PATCH(ctx);
		expect(res.status).toBe(400);
	});

	it("returns 404 for nonexistent event", async () => {
		const res = await PATCH(getContext({ id: "nonexistent" }, "PATCH", {
			teamOnePlayerIds: [],
			teamTwoPlayerIds: [],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(404);
	});

	it("returns maxPlayers in response", async () => {
		const res = await PATCH(getContext({ id: event.id }, "PATCH", {
			teamOnePlayerIds: [],
			teamTwoPlayerIds: [],
		}, { authorization: `Bearer ${accessToken}` }));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.maxPlayers).toBe(5);
	});
});

// ── PUT /api/events/[id]/teams (legacy) ────────────────────────────────────

describe("PUT /api/events/[id]/teams (legacy matches format)", () => {
	beforeEach(async () => {
		resetApiRateLimitStore();
		await prisma.teamMember.deleteMany();
		await prisma.teamResult.deleteMany();
		await prisma.player.deleteMany();
		await prisma.oauthAccessToken.deleteMany();
		await prisma.event.deleteMany();
		await prisma.user.deleteMany();
		await prisma.oauthApplication.deleteMany();

		await seedOAuthApp();
	});

	it("saves team assignments with matches format", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id });
		const token = await seedOAuthToken(owner.id);

		await prisma.player.createMany({
			data: [
				{ name: "Alice", eventId: event.id, order: 0 },
				{ name: "Bob", eventId: event.id, order: 1 },
				{ name: "Carol", eventId: event.id, order: 2 },
			],
		});

		const res = await PUT(getContext({ id: event.id }, "PUT", {
			matches: [
				{ team: "Ninjas", players: [{ name: "Alice", order: 0 }, { name: "Bob", order: 1 }] },
				{ team: "Gunas", players: [{ name: "Carol", order: 0 }] },
			],
		}, { authorization: `Bearer ${token}` }));

		expect(res.status).toBe(200);

		const teams = await prisma.teamResult.findMany({ where: { eventId: event.id }, include: { members: true } });
		expect(teams).toHaveLength(2);
		expect(teams.find((t) => t.name === "Ninjas")?.members).toHaveLength(2);
		expect(teams.find((t) => t.name === "Gunas")?.members).toHaveLength(1);
	});

	it("rejects bench players in matches", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id, maxPlayers: 2 });
		const token = await seedOAuthToken(owner.id);

		await prisma.player.createMany({
			data: [
				{ name: "Alice", eventId: event.id, order: 0 },
				{ name: "Bob", eventId: event.id, order: 1 },
				{ name: "Carol", eventId: event.id, order: 2 },
			],
		});

		const res = await PUT(getContext({ id: event.id }, "PUT", {
			matches: [
				{ team: "Ninjas", players: [{ name: "Alice", order: 0 }] },
				{ team: "Gunas", players: [{ name: "Carol", order: 0 }] },
			],
		}, { authorization: `Bearer ${token}` }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain("Carol");
	});

	it("rejects missing matches array", async () => {
		const owner = await seedUser();
		const event = await seedEvent({ ownerId: owner.id });

		const res = await PUT(getContext({ id: event.id }, "PUT", {
			something: "else",
		}));

		expect(res.status).toBe(400);
	});
});