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
  /** The per-call request options that must survive the migration (abort, cookies, headers). */
  init?: Pick<RequestInit, "signal" | "credentials" | "keepalive" | "headers">;
};

export class ApiError extends Error {
  readonly status: number;
  /** The parsed error body, for callers that branch on a field the message does not carry. */
  readonly payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
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

async function send<Op extends ApiOperation>(
  operation: Op,
  input?: ApiInput<Op>,
): Promise<Response> {
  const { params, query, body, init } = (input ?? {}) as {
    params?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    init?: Pick<RequestInit, "signal" | "credentials" | "keepalive" | "headers">;
  };

  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(name, String(value));
  }
  const queryString = search.toString();
  const url = buildApiPath(operation, params) + (queryString ? `?${queryString}` : "");
  const hasBody = body !== undefined;

  return fetch(url, {
    method: operation.slice(0, operation.indexOf(" ")),
    ...init,
    ...(hasBody
      ? {
          headers: { ...init?.headers, "Content-Type": APPLICATION_JSON },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes(APPLICATION_JSON)
    ? await response.json().catch(() => undefined)
    : await response.text();
}

async function failure(response: Response): Promise<ApiError> {
  const payload = await readPayload(response);
  const message =
    typeof payload === "object" && payload !== null
      ? ["error", "message"]
          .map((key) => (payload as Record<string, unknown>)[key])
          .find((value): value is string => typeof value === "string")
      : undefined;
  return new ApiError(message ?? `Request failed: ${response.status}`, response.status, payload);
}

/** The raw response, for a caller that needs the bytes (a file download) rather than JSON. */
export async function apiFetch<Op extends ApiOperation>(
  operation: Op,
  input?: ApiInput<Op>,
): Promise<Response> {
  const response = await send(operation, input);
  if (!response.ok) throw await failure(response);
  return response;
}

export async function apiRequest<Op extends ApiOperation>(
  operation: Op,
  input?: ApiInput<Op>,
): Promise<unknown> {
  return readPayload(await apiFetch(operation, input));
}
