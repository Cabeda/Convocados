import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { authorizeEventMutation, eventMutationDenied } from "../../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { addEnrollment, removeEnrollment } from "../../../../../lib/priority.server";

/** POST — owner manually adds a player to priority list */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true, ownerId: true, isPublic: true, accessPassword: true, priorityEnabled: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) return eventMutationDenied(authz, "Only the event owner can manage priority players.");

  if (!event.priorityEnabled) {
    return Response.json({ error: "Priority enrollment is not enabled." }, { status: 400 });
  }

  const userId = params.userId;
  if (!userId) return Response.json({ error: "User ID is required." }, { status: 400 });

  // Verify user exists
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return Response.json({ error: "User not found." }, { status: 404 });

  const enrollment = await addEnrollment(event.id, userId, "manual");
  return Response.json({ ok: true, enrollment });
};

/** DELETE — owner removes a player from priority list */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true, ownerId: true, isPublic: true, accessPassword: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) return eventMutationDenied(authz, "Only the event owner can manage priority players.");

  const userId = params.userId;
  if (!userId) return Response.json({ error: "User ID is required." }, { status: 400 });

  await removeEnrollment(event.id, userId);
  return Response.json({ ok: true });
};
