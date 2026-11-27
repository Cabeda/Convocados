import type { APIRoute } from "astro";
import { GET as getHealth } from "../health";

/** Strict probe for external monitors: mirrors /api/health but turns the
 * body-only `degraded` flag into a 503, so a stale scheduler heartbeat fails
 * the check. The public route must keep returning 200 (see health.ts): the
 * scheduler polls through it, and a 503 would remove the instance from the
 * load balancer and deadlock the heartbeat. */
export const GET: APIRoute = async (context) => {
  const response = await getHealth(context);
  if (response.status !== 200) return response;
  const body = await response.json();
  return Response.json(body, { status: body.degraded === true ? 503 : 200 });
};
