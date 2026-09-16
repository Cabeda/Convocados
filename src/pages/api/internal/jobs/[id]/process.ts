import type { APIRoute } from "astro";
import { processJob } from "~/lib/scheduler.server";
import { requireCronSecret } from "~/lib/cronAuth.server";

export const POST: APIRoute = async ({ params, request }) => {
  const schedulerSecret = import.meta.env.SCHEDULER_SECRET ?? process.env.SCHEDULER_SECRET;
  const denied = requireCronSecret(request, schedulerSecret);
  if (denied) return denied;

  const jobId = params.id;
  if (!jobId) {
    return Response.json({ error: "Job ID is required." }, { status: 400 });
  }

  try {
    await processJob(jobId);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job processing failed";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
};
