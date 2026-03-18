import { describe, it, expect } from "vitest";
import { openApiSpec } from "../lib/openapi";

describe("OpenAPI spec", () => {
  it("has valid openapi version 3.1.0", () => {
    expect(openApiSpec.openapi).toBe("3.1.0");
  });

  it("has info with title and version", () => {
    expect(openApiSpec.info.title).toBe("Convocados API");
    expect(openApiSpec.info.version).toBeDefined();
  });

  it("has paths defined", () => {
    expect(Object.keys(openApiSpec.paths).length).toBeGreaterThan(0);
  });

  it("includes core event endpoints", () => {
    expect(openApiSpec.paths["/api/events"]).toBeDefined();
    expect(openApiSpec.paths["/api/events/{id}"]).toBeDefined();
    expect(openApiSpec.paths["/api/events/{id}/players"]).toBeDefined();
    expect(openApiSpec.paths["/api/events/{id}/teams"]).toBeDefined();
  });

  it("includes health endpoint", () => {
    expect(openApiSpec.paths["/api/health"]).toBeDefined();
  });

  it("includes public events endpoint", () => {
    expect(openApiSpec.paths["/api/events/public"]).toBeDefined();
  });

  it("includes user endpoints", () => {
    expect(openApiSpec.paths["/api/users/{id}"]).toBeDefined();
  });

  it("includes webhook endpoints", () => {
    expect(openApiSpec.paths["/api/events/{id}/webhooks"]).toBeDefined();
  });

  it("all paths have at least one method", () => {
    for (const [path, methods] of Object.entries(openApiSpec.paths)) {
      const methodKeys = Object.keys(methods as object).filter((k) =>
        ["get", "post", "put", "patch", "delete"].includes(k),
      );
      expect(methodKeys.length, `${path} should have at least one HTTP method`).toBeGreaterThan(0);
    }
  });

  it("all operations have summary and responses", () => {
    for (const [path, methods] of Object.entries(openApiSpec.paths)) {
      for (const [method, op] of Object.entries(methods as Record<string, any>)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        expect(op.summary, `${method.toUpperCase()} ${path} missing summary`).toBeDefined();
        expect(op.responses, `${method.toUpperCase()} ${path} missing responses`).toBeDefined();
      }
    }
  });
});
