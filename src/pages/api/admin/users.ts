import type { APIRoute } from "astro";
import { getSession } from "~/lib/auth.helpers.server";
import { isAdmin, listUsers, type UserListSort, type UserListOrder, type UserListFilter } from "~/lib/admin.server";

export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !(await isAdmin(session.user.id))) {
    return new Response("Forbidden", { status: 403 });
  }
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  const search = url.searchParams.get("search") || undefined;
  const sort = (url.searchParams.get("sort") as UserListSort) || "createdAt";
  const order = (url.searchParams.get("order") as UserListOrder) || "desc";
  const hasPushToken = url.searchParams.get("hasPushToken");
  const pushPlatform = url.searchParams.get("pushPlatform");

  const filter: UserListFilter = {};
  if (hasPushToken === "true") filter.hasPushToken = true;
  else if (hasPushToken === "false") filter.hasPushToken = false;
  if (pushPlatform) filter.pushPlatform = pushPlatform as "android" | "ios" | "web" | null;

  const result = await listUsers({ page, pageSize, search, sort, order, filter });
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
};
