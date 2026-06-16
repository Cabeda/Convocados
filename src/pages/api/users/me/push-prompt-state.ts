import type { APIRoute } from "astro";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { setPushPromptState, type PushPromptState } from "~/lib/rsvp.server";

const ALLOWED: PushPromptState[] = ["default", "granted", "dismissed", "denied"];

/** PUT /api/users/me/push-prompt-state — body { state: "default"|"granted"|"dismissed"|"denied" } */
export const PUT: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const state = body?.state as PushPromptState;
  if (!ALLOWED.includes(state)) {
    return Response.json({ error: `state must be one of: ${ALLOWED.join(", ")}` }, { status: 400 });
  }

  await setPushPromptState(session.user.id, state);
  return Response.json({ ok: true, state });
};
