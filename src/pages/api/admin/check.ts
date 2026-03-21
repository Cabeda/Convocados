import type { APIRoute } from "astro";
import { getSession } from "~/lib/auth.helpers.server";
import { isAdmin } from "~/lib/admin.server";

/** Lightweight endpoint: returns { isAdmin: boolean } for the current session. */
export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id) {
    return Response.json({ isAdmin: false });
  }
  const admin = await isAdmin(session.user.id);
  return Response.json({ isAdmin: admin });
};
