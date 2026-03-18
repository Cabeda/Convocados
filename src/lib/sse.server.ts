/** Format a Server-Sent Event message. */
export function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type Controller = ReadableStreamDefaultController<string>;

/** In-memory SSE connection manager. One per server process. */
export function createSSEManager() {
  const connections = new Map<string, Set<Controller>>();

  return {
    add(eventId: string, controller: Controller) {
      if (!connections.has(eventId)) connections.set(eventId, new Set());
      connections.get(eventId)!.add(controller);
    },

    remove(eventId: string, controller: Controller) {
      connections.get(eventId)?.delete(controller);
      if (connections.get(eventId)?.size === 0) connections.delete(eventId);
    },

    broadcast(eventId: string, event: string, data: unknown) {
      const controllers = connections.get(eventId);
      if (!controllers) return;
      const msg = formatSSE(event, data);
      for (const c of controllers) {
        try { c.enqueue(msg); } catch { /* client disconnected */ }
      }
    },

    getConnectionCount(eventId: string): number {
      return connections.get(eventId)?.size ?? 0;
    },
  };
}

/** Singleton SSE manager for the app. */
export const sseManager = createSSEManager();
