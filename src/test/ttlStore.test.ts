import { describe, it, expect } from "vitest";
import { createTtlStore } from "~/lib/ttlStore";

interface Entry { expiresAt: number; value: number }

describe("ttlStore", () => {
  it("evicts expired on get", () => {
    const s = createTtlStore<Entry>(10);
    s.set("k", { expiresAt: Date.now() - 1, value: 1 });
    expect(s.get("k")).toBeUndefined();
    expect(s.size()).toBe(0);
  });

  it("enforces cap by evicting oldest", () => {
    const s = createTtlStore<Entry>(2);
    s.set("a", { expiresAt: Date.now() + 100000, value: 1 });
    s.set("b", { expiresAt: Date.now() + 100000, value: 2 });
    s.set("c", { expiresAt: Date.now() + 100000, value: 3 });
    expect(s.size()).toBe(2);
    expect(s.get("a")).toBeUndefined();
    expect(s.get("c")).toBeDefined();
  });

  it("sweep removes expired", () => {
    const s = createTtlStore<Entry>(10);
    s.set("x", { expiresAt: Date.now() - 1, value: 1 });
    s.set("y", { expiresAt: Date.now() + 100000, value: 2 });
    expect(s.sweep()).toBe(1);
    expect(s.size()).toBe(1);
  });

  it("clear empties", () => {
    const s = createTtlStore<Entry>(10);
    s.set("k", { expiresAt: Date.now() + 100000, value: 1 });
    s.clear();
    expect(s.size()).toBe(0);
  });
});
