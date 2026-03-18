import { describe, it, expect } from "vitest";
import { createSSEManager, formatSSE } from "~/lib/sse.server";

describe("formatSSE", () => {
  it("formats event with data", () => {
    const result = formatSSE("player_joined", { name: "Alice" });
    expect(result).toBe('event: player_joined\ndata: {"name":"Alice"}\n\n');
  });

  it("formats heartbeat", () => {
    const result = formatSSE("heartbeat", {});
    expect(result).toBe('event: heartbeat\ndata: {}\n\n');
  });
});

describe("createSSEManager", () => {
  it("creates a manager with add/remove/broadcast", () => {
    const manager = createSSEManager();
    expect(manager.add).toBeTypeOf("function");
    expect(manager.remove).toBeTypeOf("function");
    expect(manager.broadcast).toBeTypeOf("function");
    expect(manager.getConnectionCount).toBeTypeOf("function");
  });

  it("tracks connections per event", () => {
    const manager = createSSEManager();
    const controller1 = { enqueue: () => {}, close: () => {} } as any;
    const controller2 = { enqueue: () => {}, close: () => {} } as any;

    manager.add("evt-1", controller1);
    manager.add("evt-1", controller2);
    manager.add("evt-2", controller1);

    expect(manager.getConnectionCount("evt-1")).toBe(2);
    expect(manager.getConnectionCount("evt-2")).toBe(1);
  });

  it("broadcasts to all connections for an event", () => {
    const manager = createSSEManager();
    const enqueued: string[] = [];
    const controller = { enqueue: (s: string) => enqueued.push(s), close: () => {} } as any;

    manager.add("evt-1", controller);
    manager.broadcast("evt-1", "player_joined", { name: "Bob" });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toContain("player_joined");
    expect(enqueued[0]).toContain("Bob");
  });

  it("removes connections", () => {
    const manager = createSSEManager();
    const controller = { enqueue: () => {}, close: () => {} } as any;

    manager.add("evt-1", controller);
    expect(manager.getConnectionCount("evt-1")).toBe(1);

    manager.remove("evt-1", controller);
    expect(manager.getConnectionCount("evt-1")).toBe(0);
  });

  it("does not fail broadcasting to empty event", () => {
    const manager = createSSEManager();
    expect(() => manager.broadcast("nonexistent", "test", {})).not.toThrow();
  });
});
