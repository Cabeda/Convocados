import type { APIRoute } from "astro";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { getNtfyTopicUrl } from "../../../lib/push.server";

/**
 * GET /api/push/ntfy-topic — Returns the ntfy topic URL for the authenticated user.
 * The mobile app uses this to subscribe to push notifications via SSE.
 */
export const GET: APIRoute = async ({ request }) => {
  const authCtx = await authenticateRequest(request);
  if (!authCtx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const topicUrl = getNtfyTopicUrl(authCtx.userId);

  return Response.json({
    topicUrl,
    sseUrl: `${topicUrl}/sse`,
    jsonUrl: `${topicUrl}/json`,
  });
};
