import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { processGame } from "../../../../../lib/elo.server";
import { computeGameUpdates } from "../../../../../lib/elo";
import { checkOwnership } from "../../../../../lib/auth.helpers.server";

// PATCH /api/events/[id]/history/[historyId]
export const PATCH: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner } = await checkOwnership(request, event.ownerId);
  if (event.ownerId && !isOwner) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const entry = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });
  if (!entry) return Response.json({ error: "Not found." }, { status: 404 });
  if (entry.editableUntil <= new Date()) {
    return Response.json({ error: "This result can no longer be edited." }, { status: 403 });
  }

  const body = await request.json();
  const status = ["played", "cancelled"].includes(body.status) ? body.status : undefined;
  const scoreOne = body.scoreOne !== undefined ? (body.scoreOne === null ? null : parseInt(String(body.scoreOne), 10)) : undefined;
  const scoreTwo = body.scoreTwo !== undefined ? (body.scoreTwo === null ? null : parseInt(String(body.scoreTwo), 10)) : undefined;
  const teamsSnapshot = body.teamsSnapshot !== undefined ? JSON.stringify(body.teamsSnapshot) : undefined;
  const paymentsSnapshot = body.paymentsSnapshot !== undefined
    ? (body.paymentsSnapshot === null ? null : JSON.stringify(body.paymentsSnapshot))
    : undefined;

  const updated = await prisma.gameHistory.update({
    where: { id: params.historyId },
    data: {
      ...(status !== undefined && { status }),
      ...(scoreOne !== undefined && { scoreOne: isNaN(scoreOne as number) ? null : scoreOne }),
      ...(scoreTwo !== undefined && { scoreTwo: isNaN(scoreTwo as number) ? null : scoreTwo }),
      ...(teamsSnapshot !== undefined && { teamsSnapshot }),
      ...(paymentsSnapshot !== undefined && { paymentsSnapshot }),
    },
  });

  // Trigger ELO DB update when scores are saved for the first time
  const finalScoreOne = updated.scoreOne;
  const finalScoreTwo = updated.scoreTwo;
  if (
    updated.status === "played" &&
    finalScoreOne != null &&
    finalScoreTwo != null &&
    updated.teamsSnapshot &&
    !updated.eloProcessed
  ) {
    try {
      await processGame(params.id!, updated.id, JSON.parse(updated.teamsSnapshot), finalScoreOne, finalScoreTwo);
    } catch { /* ELO processing is best-effort */ }
  }

  // Always compute ELO deltas for display (even if already processed)
  let eloUpdates = null;
  if (
    updated.status === "played" &&
    finalScoreOne != null &&
    finalScoreTwo != null &&
    updated.teamsSnapshot
  ) {
    try {
      const snapshot = JSON.parse(updated.teamsSnapshot);
      const ratings = await prisma.playerRating.findMany({ where: { eventId: params.id } });
      const playerInfos = ratings.map((r) => ({ name: r.name, rating: r.rating, gamesPlayed: r.gamesPlayed }));
      eloUpdates = computeGameUpdates(playerInfos, snapshot, finalScoreOne, finalScoreTwo)
        .map((u) => ({ name: u.name, delta: u.delta }));
    } catch { /* best-effort */ }
  }

  return Response.json({
    ...updated,
    dateTime: updated.dateTime.toISOString(),
    editableUntil: updated.editableUntil.toISOString(),
    createdAt: updated.createdAt.toISOString(),
    editable: updated.editableUntil > new Date(),
    eloUpdates,
  });
};
