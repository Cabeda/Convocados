import type { APIRoute } from "astro";
import { getDueJobs, recordSchedulerHeartbeat, DEFAULT_DUE_LIMIT } from "~/lib/scheduler.server";
import { requireCronSecret } from "~/lib/cronAuth.server";

export const GET: APIRoute = async ({ request }) => {
  const schedulerSecret = import.meta.env.SCHEDULER_SECRET ?? process.env.SCHEDULER_SECRET;
  const denied = requireCronSecret(request, schedulerSecret);
  if (denied) return denied;

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(requested) && requested >= 1
      ? Math.min(requested, 200)
      : DEFAULT_DUE_LIMIT;

  await recordSchedulerHeartbeat();
  const jobs = await getDueJobs(limit);
  return Response.json({ jobs });
};
