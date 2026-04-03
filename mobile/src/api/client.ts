/**
 * API client for the Convocados server.
 *
 * All requests go through `apiFetch` which handles:
 * - Bearer token injection
 * - Automatic token refresh on 401
 * - Server URL resolution
 */
import { getValidToken, refreshAccessToken, logout } from "~/auth/oauth";
import { getServerUrl } from "~/auth/storage";

/** Authenticated fetch — injects Bearer token, retries once on 401 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const serverUrl = await getServerUrl();
  const url = `${serverUrl}${path}`;

  let token: string;
  try {
    token = await getValidToken();
  } catch {
    throw new Error("Not authenticated");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");

  let res = await fetch(url, { ...init, headers });

  // Retry once on 401 — token may have just expired
  if (res.status === 401) {
    try {
      const newTokens = await refreshAccessToken();
      headers.set("Authorization", `Bearer ${newTokens.accessToken}`);
      res = await fetch(url, { ...init, headers });
    } catch {
      await logout();
      throw new Error("Session expired");
    }
  }

  return res;
}

/** Typed GET helper */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? "Request failed");
  }
  return res.json();
}

/** Typed POST helper */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, data.error ?? "Request failed");
  }
  return res.json();
}

/** Typed PATCH helper */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, data.error ?? "Request failed");
  }
  return res.json();
}

/** Typed DELETE helper */
export async function apiDelete<T = { ok: boolean }>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "DELETE",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { ok: true } as T;
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, data.error ?? "Request failed");
  }
  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
