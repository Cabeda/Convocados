import { describe, it, expect } from "vitest";
import { withKeyedLock } from "~/lib/keyedLock";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withKeyedLock", () => {
  it("runs calls on one key one after another, in order", async () => {
    const log: string[] = [];
    const run = (name: string, ms: number) => withKeyedLock("k", async () => { log.push(`${name}:start`); await tick(ms); log.push(`${name}:end`); });
    await Promise.all([run("a", 15), run("b", 1)]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("does not hold up another key", async () => {
    const log: string[] = [];
    await Promise.all([
      withKeyedLock("slow", async () => { await tick(20); log.push("slow"); }),
      withKeyedLock("fast", async () => { log.push("fast"); }),
    ]);
    expect(log).toEqual(["fast", "slow"]);
  });

  it("lets the next call run after one throws, and passes the error on", async () => {
    const failing = withKeyedLock("k", async () => { throw new Error("boom"); });
    const next = withKeyedLock("k", async () => "ok");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
