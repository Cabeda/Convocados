import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { processGame } from "../../../../../lib/elo.server";

// PATCH /api/events/[id]/history/[historyId]
export const PATCH: APIRoute = async ({ params, request }) => {
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

  const updated = await prisma.gameHistory.update({
    where: { id: params.historyId },
    data: {
      ...(status !== undefined && { status }),
      ...(scoreOne !== undefined && { scoreOne: isNaN(scoreOne as number) ? null : scoreOne }),
      ...(scoreTwo !== undefined && { scoreTwo: isNaN(scoreTwo as number) ? null : scoreTwo }),
      ...(teamsSnapshot !== undefined && { teamsSnapshot }),
    },
  });

  // Trigger ELO recalculation when scores are saved on a played game
  let eloUpdates = null;
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
      const snapshot = JSON.parse(updated.teamsSnapshot);
      eloUpdates = await processGame(params.id!, updated.id, snapshot, finalScoreOne, finalScoreTwo);
    } catch { /* ELO processing is best-effort */ }
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
