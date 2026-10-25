/** Runtime half of the typed API client; `generated.ts` holds the operation map. */
import type { ApiOperations } from "./generated";

export type ApiOperation = keyof ApiOperations;

type InputOf<Op extends ApiOperation> =
  ApiOperations[Op] extends { params: infer P } ? { params: P } : { params?: never };
type QueryOf<Op extends ApiOperation> =
  ApiOperations[Op] extends { query: infer Q } ? { query?: Q } : { query?: never };
type BodyOf<Op extends ApiOperation> =
  ApiOperations[Op] extends { body: infer B } ? { body: B } : { body?: never };

export type ApiInput<Op extends ApiOperation> = InputOf<Op> & QueryOf<Op> & BodyOf<Op> & {
  /** The per-call request options that must survive the migration (abort, cookies). */
  init?: Pick<RequestInit, "signal" | "credentials" | "keepalive">;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const APPLICATION_JSON = "application/json";

/** `"PUT /api/events/{id}/title"` → `"/api/events/e1/title"`. */
export function buildApiPath(
  operation: ApiOperation,
  params: Record<string, unknown> | undefined,
): string {
  const path = operation.slice(operation.indexOf(" ") + 1);
  return path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${operation}`);
    return encodeURIComponent(String(value));
  });
}

export async function apiRequest<Op extends ApiOperation>(
  operation: Op,
  input?: ApiInput<Op>,
): Promise<unknown> {
  const { params, query, body, init } = (input ?? {}) as {
    params?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    init?: Pick<RequestInit, "signal" | "credentials" | "keepalive">;
  };

  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(name, String(value));
  }
  const queryString = search.toString();
  const url = buildApiPath(operation, params) + (queryString ? `?${queryString}` : "");
  const hasBody = body !== undefined;

  const response = await fetch(url, {
    method: operation.slice(0, operation.indexOf(" ")),
    ...init,
    ...(hasBody
      ? { headers: { "Content-Type": APPLICATION_JSON }, body: JSON.stringify(body) }
      : {}),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes(APPLICATION_JSON)
    ? ((await response.json().catch(() => undefined)) as unknown)
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null
        ? ["error", "message"]
            .map((key) => (payload as Record<string, unknown>)[key])
            .find((value): value is string => typeof value === "string")
        : undefined;
    throw new ApiError(message ?? `Request failed: ${response.status}`, response.status);
  }

  return payload;
}
