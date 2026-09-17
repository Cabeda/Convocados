import { describe, it, expect } from "vitest";
import { openApiSpec } from "../lib/openapi";
import pkg from "../../package.json";

describe("OpenAPI spec", () => {
  it("has valid openapi version 3.1.0", () => {
    expect(openApiSpec.openapi).toBe("3.1.0");
  });

  it("has info with title and version", () => {
    expect(openApiSpec.info.title).toBe("Convocados API");
    expect(openApiSpec.info.version).toBeDefined();
  });

  it("serves the package version so the contract tracks the app", () => {
    expect(openApiSpec.info.version).toBe(pkg.version);
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

  it("marks the anonymous read operations with an empty security array", () => {
    const anonymousPaths = [
      "/api/health",
      "/api/openapi.json",
      "/api/events/public",
      "/api/events/{id}",
      "/api/events/{id}/status",
      "/api/events/{id}/calendar",
      "/api/events/{id}/calendar.ics",
      "/api/users/{id}",
      "/api/users/{id}/stats",
      "/api/users/{id}/calendar.ics",
      "/api/invite/{token}",
      "/api/push/vapid-public-key",
      "/.well-known/openid-configuration",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-authorization-server",
    ];

    for (const path of anonymousPaths) {
      const op = (openApiSpec.paths as Record<string, any>)[path]?.get;
      expect(op, `${path} GET missing`).toBeDefined();
      expect(op.security, `${path} GET must declare security: []`).toEqual([]);
    }
  });

  it("never marks a mutation as anonymous", () => {
    for (const [path, methods] of Object.entries(openApiSpec.paths)) {
      for (const [method, op] of Object.entries(methods as Record<string, any>)) {
        if (method === "get") continue;
        expect(op.security, `${method.toUpperCase()} ${path} must not be anonymous`).not.toEqual([]);
      }
    }
  });
});
