import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const body = await request.json();
  const raw = parseInt(String(body.durationMinutes), 10);

  if (isNaN(raw) || raw < 0 || raw > 600) {
    return Response.json(
      { error: "durationMinutes must be between 0 and 600." },
      { status: 400 },
    );
  }

  await prisma.event.update({
    where: { id: params.id },
    data: { durationMinutes: raw },
  });

  return Response.json({ ok: true, durationMinutes: raw });
};
