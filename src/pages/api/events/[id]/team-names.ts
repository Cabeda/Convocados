import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const { teamOneName, teamTwoName } = await request.json();

  const one = String(teamOneName ?? "").trim().slice(0, 50) || "Ninjas";
  const two = String(teamTwoName ?? "").trim().slice(0, 50) || "Gunas";

  await prisma.event.update({ where: { id: eventId }, data: { teamOneName: one, teamTwoName: two } });
  return Response.json({ ok: true });
};
