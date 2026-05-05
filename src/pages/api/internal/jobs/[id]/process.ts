import type { APIRoute } from "astro";
import { processJob } from "~/lib/scheduler.server";

export const POST: APIRoute = async ({ params, request }) => {
  const schedulerSecret = import.meta.env.SCHEDULER_SECRET ?? process.env.SCHEDULER_SECRET;
  if (schedulerSecret && request.headers.get("authorization") !== `Bearer ${schedulerSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

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
