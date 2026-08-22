import type { APIRoute } from "astro";
import { getSession } from "../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { parsePaginationParams } from "../../../lib/pagination";
import { fetchMyGames } from "../../../lib/myGames.server";

export const GET: APIRoute = async ({ request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const { limit } = parsePaginationParams(url);
  const ownedCursor = url.searchParams.get("ownedCursor") || null;
  const followedCursor = url.searchParams.get("followedCursor") || null;

  const result = await fetchMyGames(userId, limit, ownedCursor, followedCursor);
  return Response.json(result);
};
