import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { resolveLocation } from "../../../../lib/geocode";
import { checkOwnership } from "../../../../lib/auth.helpers";

export const PUT: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner } = await checkOwnership(request, event.ownerId);
  if (event.ownerId && !isOwner) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const location = String(body.location ?? "").trim().slice(0, 200);

  // Geocode the new location
  const geo = location ? await resolveLocation(location) : null;

  await prisma.event.update({
    where: { id: params.id },
    data: {
      location,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
    },
  });

  return Response.json({
    location,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    geocoded: geo !== null,
  });
};
