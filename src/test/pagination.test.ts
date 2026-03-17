import { describe, it, expect } from "vitest";
import { parsePaginationParams, buildPaginatedResponse, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../lib/pagination";

describe("parsePaginationParams", () => {
  it("returns defaults when no params", () => {
    const url = new URL("http://localhost/api/events/public");
    const { limit, cursor } = parsePaginationParams(url);
    expect(limit).toBe(DEFAULT_PAGE_SIZE);
    expect(cursor).toBeNull();
  });

  it("parses limit and cursor", () => {
    const url = new URL("http://localhost/api/events/public?limit=10&cursor=abc123");
    const { limit, cursor } = parsePaginationParams(url);
    expect(limit).toBe(10);
    expect(cursor).toBe("abc123");
  });

  it("clamps limit to MAX_PAGE_SIZE", () => {
    const url = new URL("http://localhost/api/events/public?limit=999");
    const { limit } = parsePaginationParams(url);
    expect(limit).toBe(MAX_PAGE_SIZE);
  });

  it("clamps limit to minimum 1", () => {
    const url = new URL("http://localhost/api/events/public?limit=0");
    const { limit } = parsePaginationParams(url);
    expect(limit).toBe(1);
  });

  it("handles invalid limit gracefully", () => {
    const url = new URL("http://localhost/api/events/public?limit=abc");
    const { limit } = parsePaginationParams(url);
    expect(limit).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("buildPaginatedResponse", () => {
  const items = [
    { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" },
  ];

  it("returns all items when fewer than limit", () => {
    const result = buildPaginatedResponse(items, 10);
    expect(result.data).toHaveLength(5);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("returns hasMore when items exceed limit (take: limit+1 pattern)", () => {
    // Simulate fetching limit+1 items (3+1=4 items for limit=3)
    const fetched = items.slice(0, 4); // 4 items fetched with take: 3+1
    const result = buildPaginatedResponse(fetched, 3);
    expect(result.data).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("c");
  });

  it("returns exact page when items equal limit", () => {
    const fetched = items.slice(0, 3);
    const result = buildPaginatedResponse(fetched, 3);
    expect(result.data).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("handles empty array", () => {
    const result = buildPaginatedResponse([], 20);
    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});
