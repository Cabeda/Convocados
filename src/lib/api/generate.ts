/**
 * Renders the typed operation map from the OpenAPI description. Only declared
 * path/query params and request bodies reach the output; response shapes stay
 * `unknown` because inventing them would be a new contract, not a generated one.
 * Lives here, not in the script, so output and staleness check are testable.
 */
import { openApiSpec } from "../openapi";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const HEADER = "// @generated — do not edit; run pnpm generate:api-client\n";

interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  required?: readonly string[];
  enum?: readonly (string | number | boolean)[];
  items?: Schema;
}

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
}

interface Operation {
  parameters?: readonly Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
}

export interface ApiSpec {
  paths: Record<string, Record<string, unknown>>;
}

function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function tsType(schema: Schema | undefined): string {
  if (!schema) return "unknown";
  if (schema.enum?.length) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `${tsType(schema.items)}[]`;
    case "object":
      return inlineObjectType(schema);
    default:
      return "unknown";
  }
}

/** An object schema with undeclared properties accepts any object — `never` would be a lie. */
function inlineObjectType(schema: Schema): string {
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {});
  if (fields.length === 0) return "Record<string, unknown>";
  return `{ ${fields
    .map(([name, property]) => `${propertyKey(name)}${required.has(name) ? "" : "?"}: ${tsType(property)}`)
    .join("; ")} }`;
}

function objectType(schema: Schema, indent: string): string {
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {}).map(
    ([name, property]) => `${propertyKey(name)}${required.has(name) ? "" : "?"}: ${tsType(property)}`,
  );
  return fields.length > 0 ? renderFields(fields, indent) : "Record<string, unknown>";
}

function renderFields(fields: readonly string[], indent: string): string {
  if (fields.length === 0) return "Record<string, never>";
  return `{\n${fields.map((field) => `${indent}  ${field};`).join("\n")}\n${indent}}`;
}

function renderOperation(key: string, operation: Operation): string {
  const parameters = operation.parameters ?? [];
  const sections: string[] = [];

  const pathParams = parameters.filter((parameter) => parameter.in === "path");
  if (pathParams.length > 0) {
    const fields = pathParams.map(
      (parameter) => `${propertyKey(parameter.name)}: ${tsType(parameter.schema)}`,
    );
    sections.push(`params: ${renderFields(fields, "    ")}`);
  }

  const queryParams = parameters.filter((parameter) => parameter.in === "query");
  if (queryParams.length > 0) {
    const fields = queryParams.map(
      (parameter) =>
        `${propertyKey(parameter.name)}${parameter.required ? "" : "?"}: ${tsType(parameter.schema)}`,
    );
    sections.push(`query: ${renderFields(fields, "    ")}`);
  }

  const body = operation.requestBody?.content?.["application/json"]?.schema;
  if (body) {
    const bodyType =
      body.type === "object" || body.properties ? objectType(body, "    ") : tsType(body);
    sections.push(`body: ${bodyType}`);
  }

  return `  ${JSON.stringify(key)}: ${renderFields(sections, "  ")};`;
}

export function renderApiClient(spec: ApiSpec = openApiSpec as unknown as ApiSpec): string {
  const entries: string[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      entries.push(renderOperation(`${method.toUpperCase()} ${path}`, operation as Operation));
    }
  }
  return `${HEADER}\n/**\n * Every operation in the API description, keyed "METHOD /path".\n * Response shapes are \`unknown\` until the description declares a schema.\n */\nexport interface ApiOperations {\n${entries.join("\n")}\n}\n`;
}

/** Returns a human-readable failure, or null when the committed output is current. */
export function checkApiClient(
  committed: string,
  spec: ApiSpec = openApiSpec as unknown as ApiSpec,
): string | null {
  if (committed === renderApiClient(spec)) return null;
  return "src/lib/api/generated.ts is out of date with src/lib/openapi.ts. Run `pnpm generate:api-client` and commit the result.";
}
