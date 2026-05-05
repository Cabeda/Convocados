import type { APIRoute } from "astro";
import { getDueJobs } from "~/lib/scheduler.server";

export const GET: APIRoute = async ({ request }) => {
  const schedulerSecret = import.meta.env.SCHEDULER_SECRET ?? process.env.SCHEDULER_SECRET;
  if (schedulerSecret && request.headers.get("authorization") !== `Bearer ${schedulerSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const jobs = await getDueJobs();
  return Response.json({ jobs });
};
