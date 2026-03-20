import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { verifyPassword, buildAccessCookie } from "../../../../../lib/eventAccess";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";

/** POST — Verify event password and set access cookie. */
export const POST: APIRoute = async ({ params, request }) => {
  // Stricter rate limit for password attempts
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { accessPassword: true },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });
  if (!event.accessPassword) return Response.json({ error: "Event has no password." }, { status: 400 });

  const body = await request.json();
  const { password } = body as { password?: string };

  if (!password || typeof password !== "string") {
    return Response.json({ error: "Password required." }, { status: 400 });
  }

  if (!verifyPassword(password, event.accessPassword)) {
    return Response.json({ error: "Incorrect password." }, { status: 403 });
  }

  // Password correct — set access cookie
  const cookieHeader = request.headers.get("cookie");
  const setCookie = buildAccessCookie(cookieHeader, eventId, event.accessPassword);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": setCookie,
    },
  });
};
