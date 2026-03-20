import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { hashPassword } from "../../../../lib/eventAccess";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

/** PUT — Set or remove event password (owner only). */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Only owner can manage access (ownerless events can't set passwords)
  const session = await getSession(request);
  if (!event.ownerId || !session?.user || session.user.id !== event.ownerId) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();
  const { password } = body as { password?: string | null };

  if (password === null || password === undefined || password === "") {
    // Remove password
    await prisma.event.update({
      where: { id: eventId },
      data: { accessPassword: null },
    });
    return Response.json({ ok: true, hasPassword: false });
  }

  if (typeof password !== "string" || password.length < 4 || password.length > 100) {
    return Response.json({ error: "Password must be 4-100 characters." }, { status: 400 });
  }

  const hashed = hashPassword(password);
  await prisma.event.update({
    where: { id: eventId },
    data: { accessPassword: hashed },
  });

  return Response.json({ ok: true, hasPassword: true });
};

/** GET — Check if event has password protection (public info). */
export const GET: APIRoute = async ({ params }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id! },
    select: { accessPassword: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  return Response.json({ hasPassword: !!event.accessPassword });
};
