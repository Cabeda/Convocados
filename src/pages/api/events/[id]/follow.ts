import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../../lib/authenticate.server";
import { enqueuePushSetupHintSafe } from "../../../../lib/pushSetupHint";

const OVERRIDE_FIELDS = ["mutePlayerActivity", "muteReminders", "mutePostGame", "muteEventDetails"] as const;

function pickOverrides(follow: Record<string, unknown> | null) {
  if (!follow) return {};
  return Object.fromEntries(OVERRIDE_FIELDS.map((f) => [f, follow[f] ?? null]));
}

/**
 * GET /api/events/[id]/follow — check follow state + per-event notification overrides.
 * POST /api/events/[id]/follow — follow an event.
 * PUT /api/events/[id]/follow — update per-event notification overrides.
 * DELETE /api/events/[id]/follow — unfollow an event.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) return Response.json({ following: false });

  const eventId = params.id ?? "";
  const follow = await prisma.eventFollow.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
  return Response.json({ following: !!follow, ...pickOverrides(follow) });
};

export const POST: APIRoute = async ({ params, request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const follow = await prisma.eventFollow.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId },
    update: {},
  });

  // First-time follow nudge — in-app feed reminder to enable device push
  // (7-day per-user cooldown, see pushSetupHint.ts).
  enqueuePushSetupHintSafe(userId, eventId);

  return Response.json({ ok: true, following: true, ...pickOverrides(follow) });
};

export const PUT: APIRoute = async ({ params, request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const eventId = params.id ?? "";
  const existing = await prisma.eventFollow.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
  if (!existing) return Response.json({ error: "Not following this event." }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const data: Record<string, boolean | null> = {};
  for (const field of OVERRIDE_FIELDS) {
    if (field in body) {
      const val = body[field];
      if (val !== null && typeof val !== "boolean") {
        return Response.json({ error: `"${field}" must be boolean or null` }, { status: 400 });
      }
      data[field] = val as boolean | null;
    }
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "No valid fields provided" }, { status: 400 });
  }

  const follow = await prisma.eventFollow.update({
    where: { eventId_userId: { eventId, userId } },
    data,
  });

  return Response.json({ ok: true, following: true, ...pickOverrides(follow) });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const eventId = params.id ?? "";
  await prisma.eventFollow.deleteMany({ where: { eventId, userId } });
  return Response.json({ ok: true, following: false });
};
