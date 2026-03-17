/**
 * Shared cursor-based pagination utilities.
 *
 * Standard response: { data: T[], nextCursor: string | null, hasMore: boolean }
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Parse `limit` and `cursor` from a URL's search params. */
export function parsePaginationParams(url: URL): { limit: number; cursor: string | null } {
  const rawLimit = url.searchParams.get("limit");
  const parsed = rawLimit !== null ? parseInt(rawLimit, 10) : NaN;
  const limit = Number.isNaN(parsed)
    ? DEFAULT_PAGE_SIZE
    : Math.min(Math.max(1, parsed), MAX_PAGE_SIZE);
  const cursor = url.searchParams.get("cursor") || null;
  return { limit, cursor };
}

/**
 * Build a PaginatedResponse from a list of items fetched with `take: limit + 1`.
 * The extra item is used to determine `hasMore` and derive `nextCursor`.
 */
export function buildPaginatedResponse<T extends { id: string }>(
  items: T[],
  limit: number,
): PaginatedResponse<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? data[data.length - 1].id : null;
  return { data, nextCursor, hasMore };
}
