/**
 * Builds the `/llms.txt` agent index (https://llmstxt.org).
 *
 * Everything derived here comes from a single source of truth:
 * - the endpoint list is every `GET` in the OpenAPI spec marked `security: []`
 * - the docs list is the same `docsNav` manifest the documentation sidebar uses
 *
 * Do not hardcode endpoints or doc links here — `src/test/llms.test.ts` fails
 * if the generated index and those sources disagree.
 */

import { openApiSpec } from "./openapi";
import { docsNav } from "./docsNav";

/** Paths that are technically anonymous but excluded from the read-API list. */
const NON_READ_PATHS = new Set(["/api/openapi.json", "/api/mcp"]);

interface AnonymousOperation {
  path: string;
  summary: string;
}

/** Every anonymous, read-only API operation, in deterministic path order. */
export function anonymousGetOperations(): AnonymousOperation[] {
  const operations: AnonymousOperation[] = [];

  for (const [path, methods] of Object.entries(openApiSpec.paths)) {
    if (!path.startsWith("/api/") || NON_READ_PATHS.has(path)) continue;

    const get = (methods as Record<string, unknown>).get as
      | { summary?: string; security?: unknown[] }
      | undefined;
    if (!get || !Array.isArray(get.security) || get.security.length > 0) continue;

    operations.push({ path, summary: get.summary ?? "" });
  }

  return operations.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Render the agent index. `baseUrl` is the deployment origin
 * (e.g. `https://convocados.cabeda.dev`); pass `""` for relative links.
 */
export function buildLlmsTxt(baseUrl = ""): string {
  const origin = baseUrl.replace(/\/$/, "");
  const lines: string[] = [
    "# Convocados",
    "",
    "> Organize pickup sports games — events, rosters, fair teams, scores, and payments.",
    "",
    "Everything in the **Anonymous read API** section is read-only and needs no",
    "account, key, or OAuth flow: send a plain `GET` and read JSON. Start from",
    "`/api/events/public` to discover games, then fetch one by id.",
    "",
    "The human-facing `/events/{id}` pages are client-rendered: their HTML carries",
    "no event data. Read an event with `GET /api/events/{id}`",
    "(the page also exposes it as `<link rel=\"alternate\" type=\"application/json\">`).",
    "",
    "## Anonymous read API",
    "",
  ];

  for (const op of anonymousGetOperations()) {
    lines.push(`- \`GET ${origin}${op.path}\` — ${op.summary}`);
  }

  lines.push("", "## Docs", "");
  for (const section of docsNav) {
    for (const item of section.items) {
      lines.push(`- [${item.label}](${origin}${item.href}) — ${section.title}`);
    }
  }

  lines.push(
    "",
    "## Machine surfaces",
    "",
    `- \`${origin}/api/openapi.json\` — OpenAPI 3.1 contract for every endpoint`,
    `- \`${origin}/api/mcp\` — MCP 2026-07-28 stateless tools (requires OAuth 2.1; not anonymous)`,
    `- \`${origin}/.well-known/openid-configuration\` — OpenID Connect discovery`,
    "",
    "## Rules",
    "",
    "- `isPublic` means *discoverable*, not *accessible*: only public events appear",
    "  in `/api/events/public`, the sitemap, and this index. Any event is readable by",
    "  id when you already hold its link, unless it is password-protected — those",
    "  respond with `{ \"locked\": true }`.",
    "- Mutations require OAuth 2.1. There are no anonymous writes.",
    "- Listing endpoints are paginated with `limit` and `cursor`; follow `nextCursor`.",
    "- Unknown ids return `404`. Respect rate limits (HTTP `429`).",
    "",
  );

  return lines.join("\n");
}
