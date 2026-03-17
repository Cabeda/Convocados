import { describe, it, expect, beforeEach, vi } from "vitest";
import { getKnownNames, addKnownName, getQjName, setQjName } from "~/lib/knownNames";

// Mock localStorage for Node environment
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k in store) delete store[k]; },
};

beforeEach(() => {
  localStorageMock.clear();
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
});

describe("getKnownNames", () => {
  it("returns empty array when nothing stored", () => {
    expect(getKnownNames()).toEqual([]);
  });

  it("returns stored names", () => {
    store["known_names"] = JSON.stringify(["Alice", "Bob"]);
    expect(getKnownNames()).toEqual(["Alice", "Bob"]);
  });

  it("returns empty array for invalid JSON", () => {
    store["known_names"] = "not-json";
    expect(getKnownNames()).toEqual([]);
  });
});

describe("addKnownName", () => {
  it("adds a name to the list", () => {
    addKnownName("Alice");
    expect(getKnownNames()).toEqual(["Alice"]);
  });

  it("puts new name at the front", () => {
    addKnownName("Alice");
    addKnownName("Bob");
    expect(getKnownNames()).toEqual(["Bob", "Alice"]);
  });

  it("deduplicates case-insensitively and moves to front", () => {
    addKnownName("Alice");
    addKnownName("Bob");
    addKnownName("alice");
    expect(getKnownNames()).toEqual(["alice", "Bob"]);
  });

  it("ignores empty/whitespace names", () => {
    addKnownName("");
    addKnownName("   ");
    expect(getKnownNames()).toEqual([]);
  });

  it("caps at 20 names", () => {
    for (let i = 0; i < 25; i++) addKnownName(`Player${i}`);
    expect(getKnownNames()).toHaveLength(20);
    expect(getKnownNames()[0]).toBe("Player24");
  });
});

describe("getQjName", () => {
  it("returns empty string when nothing stored", () => {
    expect(getQjName()).toBe("");
  });

  it("returns stored qj_name", () => {
    store["qj_name"] = "Alice";
    expect(getQjName()).toBe("Alice");
  });
});

describe("setQjName", () => {
  it("stores the name", () => {
    setQjName("Bob");
    expect(store["qj_name"]).toBe("Bob");
  });
});

describe("no localStorage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it("getKnownNames returns empty array", () => {
    expect(getKnownNames()).toEqual([]);
  });

  it("addKnownName is a no-op", () => {
    addKnownName("Alice");
    // No error thrown
  });

  it("getQjName returns empty string", () => {
    expect(getQjName()).toBe("");
  });

  it("setQjName is a no-op", () => {
    setQjName("Bob");
    // No error thrown
  });
});
