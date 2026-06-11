import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { rateLimitResponse } from "../../../lib/apiRateLimit.server";
import { isPlaytomicSport } from "../../../lib/playtomic";

const MAX_WATCHES_PER_USER = 20;

async function resolveUserId(request: Request): Promise<string | null> {
  const authCtx = await authenticateRequest(request);
  return authCtx?.userId ?? (await getSession(request))?.user?.id ?? null;
}

/** GET: list the current user's court watches. */
export const GET: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const userId = await resolveUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const watches = await prisma.courtWatch.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ watches });
};

/** POST: create a court watch. */
export const POST: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const userId = await resolveUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid JSON body." }, { status: 400 });

  const sport = String(body.sport ?? "").trim();
  const tenantId = String(body.tenantId ?? "").trim();
  const tenantName = String(body.tenantName ?? "").trim().slice(0, 200);
  const dayOfWeek = Number(body.dayOfWeek);
  const startTime = String(body.startTime ?? "").trim();
  const endTime = String(body.endTime ?? "").trim();

  // Validation
  if (!isPlaytomicSport(sport)) return Response.json({ error: "Unsupported sport." }, { status: 400 });
  if (!tenantId || !tenantName) return Response.json({ error: "tenantId and tenantName are required." }, { status: 400 });
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return Response.json({ error: "dayOfWeek must be 0-6." }, { status: 400 });
  }
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timeRe.test(startTime) || !timeRe.test(endTime)) {
    return Response.json({ error: "startTime/endTime must be HH:mm." }, { status: 400 });
  }
  if (startTime > endTime) {
    return Response.json({ error: "startTime must be before endTime." }, { status: 400 });
  }

  const count = await prisma.courtWatch.count({ where: { userId, active: true } });
  if (count >= MAX_WATCHES_PER_USER) {
    return Response.json({ error: `Maximum of ${MAX_WATCHES_PER_USER} active watches.` }, { status: 429 });
  }

  const durationMinutes = Number.isInteger(body.durationMinutes) && body.durationMinutes > 0 ? body.durationMinutes : 90;
  const maxPrice = typeof body.maxPrice === "number" && body.maxPrice >= 0 ? body.maxPrice : null;

  const watch = await prisma.courtWatch.create({
    data: {
      userId,
      sport,
      tenantId,
      tenantName,
      resourceId: body.resourceId ? String(body.resourceId) : null,
      resourceName: body.resourceName ? String(body.resourceName).slice(0, 200) : null,
      dayOfWeek,
      startTime,
      endTime,
      durationMinutes,
      timezone: String(body.timezone ?? "UTC").slice(0, 64),
      maxPrice,
    },
  });

  return Response.json({ watch }, { status: 201 });
};
