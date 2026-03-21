import type { APIRoute } from "astro";
import { getSession } from "~/lib/auth.helpers.server";
import { isAdmin, getGrowthTimeline } from "~/lib/admin.server";

export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !(await isAdmin(session.user.id))) {
    return new Response("Forbidden", { status: 403 });
  }
  const range = url.searchParams.get("range") ?? "30d";
  if (!["30d", "1y", "all"].includes(range)) {
    return new Response("Invalid range", { status: 400 });
  }
  const timeline = await getGrowthTimeline(range as "30d" | "1y" | "all");
  return new Response(JSON.stringify(timeline), { headers: { "Content-Type": "application/json" } });
};
