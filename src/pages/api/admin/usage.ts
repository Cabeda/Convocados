import type { APIRoute } from "astro";
import { getSession } from "../../../lib/auth.helpers.server";
import { isAdmin } from "../../../lib/admin.server";
import { getDailyUsage, getUsageSummary } from "../../../lib/usageMetrics.server";

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdmin(session.user.id))) return Response.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const days = Math.min(90, Math.max(7, parseInt(url.searchParams.get("days") ?? "30", 10)));

  const [timeline, summary] = await Promise.all([
    getDailyUsage(days),
    getUsageSummary(),
  ]);

  return Response.json({ timeline, summary });
};
