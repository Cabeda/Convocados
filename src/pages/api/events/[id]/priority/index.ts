import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import {
  getPrioritySettings,
  getEnrollments,
  updatePrioritySettings,
} from "../../../../../lib/priority.server";
import { calculateAttendance } from "../../../../../lib/attendance";
import { calculateEligibility, rankAndCap } from "../../../../../lib/priority";

/** GET — list priority settings, enrollments, and eligibility preview */
export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: {
      id: true, ownerId: true, maxPlayers: true,
      priorityEnabled: true, priorityThreshold: true, priorityWindow: true,
      priorityMaxPercent: true, priorityDeadlineHours: true, priorityMinGames: true,
    },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const enrollments = await getEnrollments(event.id);

  // Calculate eligibility preview
  const history = await prisma.gameHistory.findMany({
    where: { eventId: event.id },
    orderBy: { dateTime: "asc" },
  });

  const players = enrollments.map((e) => ({
    userId: e.userId,
    name: e.user.name,
    optedIn: e.optedIn,
    declineStreak: e.declineStreak,
    noShowStreak: e.noShowStreak,
    accountCreatedAt: e.user.createdAt,
  }));

  const settings = {
    threshold: event.priorityThreshold,
    window: event.priorityWindow,
    minGames: event.priorityMinGames,
    maxPercent: event.priorityMaxPercent,
  };

  const eligibility = calculateEligibility(history, players, settings);
  const ranked = rankAndCap(eligibility.eligible, event.maxPlayers, event.priorityMaxPercent);

  return Response.json({
    settings: {
      priorityEnabled: event.priorityEnabled,
      priorityThreshold: event.priorityThreshold,
      priorityWindow: event.priorityWindow,
      priorityMaxPercent: event.priorityMaxPercent,
      priorityDeadlineHours: event.priorityDeadlineHours,
      priorityMinGames: event.priorityMinGames,
    },
    enrollments: enrollments.map((e) => ({
      userId: e.userId,
      name: e.user.name,
      source: e.source,
      optedIn: e.optedIn,
      declineStreak: e.declineStreak,
      noShowStreak: e.noShowStreak,
    })),
    eligible: ranked.map((c) => ({
      userId: c.userId,
      name: c.name,
      attendanceRate: c.attendanceRate,
      gamesInWindow: c.gamesInWindow,
      currentStreak: c.currentStreak,
    })),
    ineligible: eligibility.ineligible,
    maxSlots: Math.floor((event.maxPlayers * event.priorityMaxPercent) / 100),
  });
};

/** PUT — update priority settings (owner only) */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true, ownerId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner } = await checkOwnership(request, event.ownerId);
  if (!isOwner) return Response.json({ error: "Only the event owner can change priority settings." }, { status: 403 });

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (typeof body.priorityEnabled === "boolean") updates.priorityEnabled = body.priorityEnabled;
  if (typeof body.priorityThreshold === "number" && body.priorityThreshold >= 1 && body.priorityThreshold <= 20)
    updates.priorityThreshold = body.priorityThreshold;
  if (typeof body.priorityWindow === "number" && body.priorityWindow >= 1 && body.priorityWindow <= 50)
    updates.priorityWindow = body.priorityWindow;
  if (typeof body.priorityMaxPercent === "number" && body.priorityMaxPercent >= 10 && body.priorityMaxPercent <= 100)
    updates.priorityMaxPercent = body.priorityMaxPercent;
  if (typeof body.priorityDeadlineHours === "number" && body.priorityDeadlineHours >= 0 && body.priorityDeadlineHours <= 168)
    updates.priorityDeadlineHours = body.priorityDeadlineHours;
  if (typeof body.priorityMinGames === "number" && body.priorityMinGames >= 1 && body.priorityMinGames <= 50)
    updates.priorityMinGames = body.priorityMinGames;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No valid fields to update." }, { status: 400 });
  }

  await updatePrioritySettings(event.id, updates as any);
  const fresh = await getPrioritySettings(event.id);
  return Response.json({ ok: true, settings: fresh });
};
