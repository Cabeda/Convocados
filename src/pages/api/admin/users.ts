import type { APIRoute } from "astro";
import { getSession } from "~/lib/auth.helpers.server";
import { isAdmin, listUsers } from "~/lib/admin.server";

export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !(await isAdmin(session.user.id))) {
    return new Response("Forbidden", { status: 403 });
  }
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  const search = url.searchParams.get("search") || undefined;

  const result = await listUsers({ page, pageSize, search });
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
};
