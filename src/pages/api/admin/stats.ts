import type { APIRoute } from "astro";
import { getSession } from "~/lib/auth.helpers.server";
import { isAdmin, getAdminStats } from "~/lib/admin.server";

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !(await isAdmin(session.user.id))) {
    return new Response("Forbidden", { status: 403 });
  }
  const stats = await getAdminStats();
  return new Response(JSON.stringify(stats), { headers: { "Content-Type": "application/json" } });
};
