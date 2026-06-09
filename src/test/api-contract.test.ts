/**
 * API Contract Test
 *
 * Parses the Android ConvocadosApi.kt to extract every HTTP endpoint it calls,
 * then asserts each one exists in the OpenAPI spec (source of truth).
 * Drift between Android and the spec fails CI immediately.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { openApiSpec } from "../lib/openapi";

interface EndpointCall {
  method: string;
  path: string;
}

function parseAndroidEndpoints(): EndpointCall[] {
  const filePath = resolve(
    __dirname,
    "../../android-app/app/src/main/java/dev/convocados/data/api/ConvocadosApi.kt",
  );
  const source = readFileSync(filePath, "utf-8");

  const endpoints: EndpointCall[] = [];
  // Matches: client.get("/api/..."), client.post("/api/..."), etc.
  const regex = /client\.(get|post|put|patch|delete)\("([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source)) !== null) {
    const method = match[1];
    // Normalize Kotlin string interpolation: $id, $eventId, $historyId, ${...} → {param}
    const rawPath = match[2]
      .replace(/\$\{[^}]+\}/g, "{id}")
      .replace(/\$eventId/g, "{id}")
      .replace(/\$historyId/g, "{historyId}")
      .replace(/\$userId/g, "{id}")
      .replace(/\$id/g, "{id}")
      .replace(/\$\w+/g, "")   // strip remaining $vars like $qs
      .replace(/\?.*/, "");    // strip query strings

    endpoints.push({ method, path: rawPath });
  }

  return endpoints;
}

function normalizeSpecPath(path: string): string {
  // OpenAPI uses {id}, {historyId}, {webhookId} — normalize all to comparable form
  return path;
}

describe("API Contract: Android ↔ OpenAPI spec", () => {
  const androidEndpoints = parseAndroidEndpoints();
  const specPaths = openApiSpec.paths as Record<string, Record<string, unknown>>;

  it("should find Android endpoints in ConvocadosApi.kt", () => {
    expect(androidEndpoints.length).toBeGreaterThan(0);
  });

  for (const { method, path } of androidEndpoints) {
    it(`${method.toUpperCase()} ${path} exists in OpenAPI spec`, () => {
      // Find matching spec path (handle param name differences)
      const normalizedAndroid = path.replace(/\{[^}]+\}/g, "{}");
      const matchingSpecPath = Object.keys(specPaths).find(
        (specPath) => normalizeSpecPath(specPath).replace(/\{[^}]+\}/g, "{}") === normalizedAndroid,
      );

      expect(
        matchingSpecPath,
        `Android calls ${method.toUpperCase()} ${path} but it's not in the OpenAPI spec. Add it to src/lib/openapi.ts`,
      ).toBeDefined();

      if (matchingSpecPath) {
        const methods = specPaths[matchingSpecPath];
        expect(
          methods[method],
          `Path ${matchingSpecPath} exists but method ${method.toUpperCase()} is not defined`,
        ).toBeDefined();
      }
    });
  }
});
