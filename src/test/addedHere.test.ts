import { describe, it, expect } from "vitest";
import { forgetAdded, isAddedHere, rememberAdded, type KeyValueStore } from "~/lib/addedHere";

const memory = (): KeyValueStore & { dump: () => Record<string, string> } => {
  const data: Record<string, string> = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, dump: () => ({ ...data }) };
};
const DAY = 86_400_000;
const T = Date.UTC(2026, 11, 1);

describe("rows added from this browser", () => {
  it("remembers a name per event and finds it again, ignoring case and accents", () => {
    const s = memory();
    rememberAdded("e1", "José Costa", T, s);
    expect(isAddedHere("e1", "jose costa", T + 1000, s)).toBe(true);
    expect(isAddedHere("e1", "Ana", T + 1000, s)).toBe(false);
    expect(isAddedHere("e2", "José Costa", T + 1000, s)).toBe(false);
  });

  it("forgets a name when its row is gone", () => {
    const s = memory();
    rememberAdded("e1", "Rui", T, s);
    forgetAdded("e1", "rui", s);
    expect(isAddedHere("e1", "Rui", T, s)).toBe(false);
  });

  it("lets a name go after three days, so next week's Ana is not the same Ana", () => {
    const s = memory();
    rememberAdded("e1", "Ana", T, s);
    expect(isAddedHere("e1", "Ana", T + 2 * DAY, s)).toBe(true);
    expect(isAddedHere("e1", "Ana", T + 4 * DAY, s)).toBe(false);
  });

  it("keeps the newest 60 names and never grows without end", () => {
    const s = memory();
    for (let i = 0; i < 80; i++) rememberAdded("e1", `P${i}`, T + i, s);
    expect(isAddedHere("e1", "P0", T + 100, s)).toBe(false);
    expect(isAddedHere("e1", "P79", T + 100, s)).toBe(true);
  });

  it("copes with broken stored data and with no storage at all", () => {
    const s = memory();
    s.setItem("added-here:e1", "{not json");
    expect(isAddedHere("e1", "Rui", T, s)).toBe(false);
    expect(() => rememberAdded("e1", "Rui", T, s)).not.toThrow();
    expect(isAddedHere("e1", "Rui", T, s)).toBe(true);
    expect(isAddedHere("e1", "Rui", T, undefined)).toBe(false);
    expect(() => rememberAdded("e1", "Rui", T, undefined)).not.toThrow();
  });

  it("copes with a store that refuses to write (private mode, full)", () => {
    const s: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error("full"); } };
    expect(() => rememberAdded("e1", "Rui", T, s)).not.toThrow();
  });
});
