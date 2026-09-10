import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { parseImageDataUrl } from "~/lib/profilePhoto";

/** Resolve the acting user from a session cookie or a bearer token. */
async function resolveUserId(request: Request): Promise<string | null> {
  const authCtx = await authenticateRequest(request);
  if (authCtx?.userId) return authCtx.userId;
  const session = await getSession(request);
  return session?.user?.id ?? null;
}

/**
 * POST /api/me/photo — set the current user's profile photo.
 * Body: `{ image: "data:image/webp;base64,..." }`
 */
export const POST: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const userId = await resolveUserId(request);
  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseImageDataUrl((body as { image?: unknown } | null)?.image);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { image: parsed.value.dataUrl },
  });

  return Response.json({ ok: true, image: parsed.value.dataUrl });
};

/** DELETE /api/me/photo — clear the current user's profile photo. */
export const DELETE: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const userId = await resolveUserId(request);
  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { image: null },
  });

  return Response.json({ ok: true, image: null });
};
