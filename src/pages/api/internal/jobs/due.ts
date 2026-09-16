import type { APIRoute } from "astro";
import { getDueJobs, recordSchedulerHeartbeat } from "~/lib/scheduler.server";
import { requireCronSecret } from "~/lib/cronAuth.server";

export const GET: APIRoute = async ({ request }) => {
  const schedulerSecret = import.meta.env.SCHEDULER_SECRET ?? process.env.SCHEDULER_SECRET;
  const denied = requireCronSecret(request, schedulerSecret);
  if (denied) return denied;

  await recordSchedulerHeartbeat();
  const jobs = await getDueJobs();
  return Response.json({ jobs });
};
