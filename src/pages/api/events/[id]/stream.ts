import type { APIRoute } from "astro";
import { sseManager, formatSSE } from "~/lib/sse.server";

export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id!;

  const stream = new ReadableStream<string>({
    start(controller) {
      sseManager.add(eventId, controller);
      controller.enqueue(formatSSE("connected", { eventId }));

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try { controller.enqueue(formatSSE("heartbeat", {})); }
        catch { clearInterval(heartbeat); }
      }, 30_000);

      // Cleanup on close — the cancel callback fires when the client disconnects
      (controller as any)._heartbeat = heartbeat;
    },
    cancel(controller: any) {
      clearInterval(controller?._heartbeat);
      sseManager.remove(eventId, controller);
    },
  });

  return new Response(stream as any, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
