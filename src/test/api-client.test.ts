import { afterEach, describe, expect, it, vi } from "vitest";
import { openApiSpec } from "../lib/openapi";
import { apiRequest } from "../lib/api/client";
import { checkApiClient, renderApiClient } from "../lib/api/generate";

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

describe("generated API client", () => {
  it("emits an operation for every method and path in the description", () => {
    const output = renderApiClient(openApiSpec);
    for (const [path, item] of Object.entries(openApiSpec.paths)) {
      for (const method of Object.keys(item)) {
        if (!METHODS.has(method)) continue;
        expect(output, `${method} ${path}`).toContain(`"${method.toUpperCase()} ${path}":`);
      }
    }
  });

  it("types path params and the request body from the description", () => {
    const output = renderApiClient(openApiSpec);
    expect(output).toContain('"PUT /api/events/{id}/title": {');
    expect(output).toContain("title?: string;");
  });

  it("changes the emitted body type when the description drifts", () => {
    const output = renderApiClient({
      paths: {
        "/api/things/{id}": {
          put: {
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { count: { type: "integer" } } },
                },
              },
            },
          },
        },
      },
    });
    expect(output).toContain("count?: number;");
    expect(output).not.toContain("count?: string;");
  });

  it("renders a nullable property from a type array", () => {
    const output = renderApiClient({
      paths: {
        "/api/things": {
          put: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { note: { type: ["string", "null"] } } },
                },
              },
            },
          },
        },
      },
    });
    expect(output).toContain("note?: string | null;");
  });

  it("fails the check mode when the committed output is stale", () => {
    const fresh = renderApiClient(openApiSpec);
    expect(checkApiClient(fresh, openApiSpec)).toBeNull();
    expect(checkApiClient(`${fresh}\n// stale\n`, openApiSpec)).toContain("out of date");
  });

  it("rejects a request body that drifts from the description at compile time", () => {
    const call = () =>
      // @ts-expect-error `title` is a string in the description
      apiRequest("PUT /api/events/{id}/title", { params: { id: "e1" }, body: { title: 42 } });
    expect(typeof call).toBe("function");
  });
});

describe("apiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("substitutes path params, sends JSON and returns the parsed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ title: "Cup" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const data = await apiRequest("PUT /api/events/{id}/title", {
      params: { id: "abc def" },
      body: { title: "Cup" },
    });

    expect(data).toEqual({ title: "Cup" });
    expect(fetchMock).toHaveBeenCalledWith("/api/events/abc%20def/title", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Cup" }),
    });
  });

  it("appends query params and sends no body when none is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("GET /api/events/public", { query: { sport: "football", hasSpots: true } });

    expect(fetchMock).toHaveBeenCalledWith("/api/events/public?sport=football&hasSpots=true", {
      method: "GET",
    });
  });

  it("passes an abort signal and cookie credentials through to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await apiRequest("GET /api/events/public", {
      init: { signal: controller.signal, credentials: "include" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/events/public", {
      method: "GET",
      signal: controller.signal,
      credentials: "include",
    });
  });

  it("throws the server message and status on a failed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Only the event owner can do this." }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      apiRequest("PUT /api/events/{id}/sport", { params: { id: "e1" }, body: { sport: "tennis" } }),
    ).rejects.toMatchObject({ status: 403, message: "Only the event owner can do this." });
  });
});
