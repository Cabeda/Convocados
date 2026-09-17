import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { docsNav, docsPages } from "../lib/docsNav";
import { anonymousGetOperations, buildLlmsTxt } from "../lib/llmsTxt";

/** Resolve a docs href to a page file (`/docs/api` → `docs/api/index.astro`). */
function docsPagePath(href: string): string | null {
  const rel = href.replace(/^\//, "");
  const candidates = [
    path.join(process.cwd(), "src/pages", `${rel}.astro`),
    path.join(process.cwd(), "src/pages", rel, "index.astro"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

describe("docsNav manifest", () => {
  it("is non-empty and every section has items", () => {
    expect(docsNav.length).toBeGreaterThan(0);
    for (const section of docsNav) {
      expect(section.title).toBeTruthy();
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  it("every nav href resolves to a docs page", () => {
    for (const page of docsPages) {
      expect(page.label, `${page.href} missing label`).toBeTruthy();
      expect(docsPagePath(page.href), `no page file for ${page.href}`).not.toBeNull();
    }
  });

  it("tags every flattened page with its section", () => {
    for (const page of docsPages) {
      expect(page.section, `${page.href} missing section`).toBeTruthy();
    }
  });
});

describe("anonymousGetOperations", () => {
  it("returns only anonymous GET api paths, sorted", () => {
    const ops = anonymousGetOperations();
    expect(ops.length).toBeGreaterThan(0);
    const paths = ops.map((o) => o.path);
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
    for (const op of ops) {
      expect(op.path.startsWith("/api/")).toBe(true);
      expect(op.path).not.toBe("/api/mcp");
      expect(op.path).not.toBe("/api/openapi.json");
      expect(op.summary).toBeTruthy();
    }
  });

  it("excludes authenticated endpoints", () => {
    const paths = anonymousGetOperations().map((o) => o.path);
    expect(paths).not.toContain("/api/events");
    expect(paths).not.toContain("/api/me/games");
    expect(paths).not.toContain("/api/events/{id}/payments");
  });
});

describe("buildLlmsTxt", () => {
  const base = "https://convocados.example";
  const txt = buildLlmsTxt(base);

  it("starts with the H1 and summary blockquote", () => {
    expect(txt.startsWith("# Convocados\n")).toBe(true);
    expect(txt).toContain("\n> ");
  });

  it("lists every anonymous operation with an absolute URL", () => {
    for (const op of anonymousGetOperations()) {
      expect(txt).toContain(`GET ${base}${op.path}`);
    }
  });

  it("links every docs page and section", () => {
    for (const page of docsPages) {
      expect(txt).toContain(`[${page.label}](${base}${page.href})`);
    }
  });

  it("advertises the machine surfaces but not MCP as anonymous", () => {
    expect(txt).toContain(`${base}/api/openapi.json`);
    expect(txt).toContain("/api/mcp");
    expect(txt).toContain("OAuth 2.1");
    // MCP must never appear in the anonymous read list.
    expect(txt).not.toMatch(/- `GET [^`]*\/api\/mcp/);
  });

  it("states the discoverable-vs-accessible rule", () => {
    expect(txt).toContain("discoverable");
    expect(txt).toContain("locked");
  });

  it("tells agents the event pages are client-rendered and to use the JSON API", () => {
    expect(txt).toContain("client-rendered");
    expect(txt).toContain("GET /api/events/{id}");
    expect(txt).toContain('rel="alternate"');
  });

  it("uses relative links when no base URL is given", () => {
    const relative = buildLlmsTxt();
    expect(relative).toContain("`GET /api/events/public`");
    expect(relative).not.toContain("undefined");
  });
});
