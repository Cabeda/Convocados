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

  it("broadcasts update events to multiple clients", () => {
    const manager = createSSEManager();
    const messages1: string[] = [];
    const messages2: string[] = [];
    const c1 = { enqueue: (s: string) => messages1.push(s), close: () => {} } as any;
    const c2 = { enqueue: (s: string) => messages2.push(s), close: () => {} } as any;

    manager.add("evt-1", c1);
    manager.add("evt-1", c2);
    manager.broadcast("evt-1", "update", { action: "player_added" });

    expect(messages1).toHaveLength(1);
    expect(messages2).toHaveLength(1);
    expect(messages1[0]).toBe('event: update\ndata: {"action":"player_added"}\n\n');
    expect(messages2[0]).toBe(messages1[0]);
  });

  it("does not broadcast to other events", () => {
    const manager = createSSEManager();
    const messages1: string[] = [];
    const messages2: string[] = [];
    const c1 = { enqueue: (s: string) => messages1.push(s), close: () => {} } as any;
    const c2 = { enqueue: (s: string) => messages2.push(s), close: () => {} } as any;

    manager.add("evt-1", c1);
    manager.add("evt-2", c2);
    manager.broadcast("evt-1", "update", { action: "player_added" });

    expect(messages1).toHaveLength(1);
    expect(messages2).toHaveLength(0);
  });

  it("handles disconnected client gracefully during broadcast", () => {
    const manager = createSSEManager();
    const messages: string[] = [];
    const goodController = { enqueue: (s: string) => messages.push(s), close: () => {} } as any;
    const badController = {
      enqueue: () => { throw new Error("client disconnected"); },
      close: () => {},
    } as any;

    manager.add("evt-1", goodController);
    manager.add("evt-1", badController);

    // Should not throw, and the good client should still receive the message
    expect(() => manager.broadcast("evt-1", "update", { action: "player_removed" })).not.toThrow();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("player_removed");
  });

  it("cleans up event entry when last connection is removed", () => {
    const manager = createSSEManager();
    const c = { enqueue: () => {}, close: () => {} } as any;

    manager.add("evt-1", c);
    expect(manager.getConnectionCount("evt-1")).toBe(1);

    manager.remove("evt-1", c);
    expect(manager.getConnectionCount("evt-1")).toBe(0);

    // Broadcast to cleaned-up event should be a no-op
    expect(() => manager.broadcast("evt-1", "update", {})).not.toThrow();
  });

  it("supports multiple sequential broadcasts", () => {
    const manager = createSSEManager();
    const messages: string[] = [];
    const c = { enqueue: (s: string) => messages.push(s), close: () => {} } as any;

    manager.add("evt-1", c);
    manager.broadcast("evt-1", "update", { action: "player_added" });
    manager.broadcast("evt-1", "update", { action: "teams_randomized" });
    manager.broadcast("evt-1", "update", { action: "title_updated" });

    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain("player_added");
    expect(messages[1]).toContain("teams_randomized");
    expect(messages[2]).toContain("title_updated");
  });
});
