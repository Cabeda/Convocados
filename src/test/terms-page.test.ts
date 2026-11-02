import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("terms of service page", () => {
  const page = read("src/pages/terms.astro");

  it("states every topic an app listing requires", () => {
    // ChatGPT app review rejected the package for having no live terms page, so
    // the sections a reviewer looks for are pinned rather than left to drift.
    for (const heading of [
      "Your account",
      "Acceptable use",
      "Costs and payments",
      "AI assistants",
      "Availability and changes",
      "Ending your use",
      "Governing law",
      "Contact",
    ]) {
      expect(page, `missing "${heading}"`).toContain(`<h2>${heading}</h2>`);
    }
  });

  it("links the privacy policy and a reachable contact", () => {
    expect(page).toContain('href="/privacy"');
    expect(page).toMatch(/mailto:[^"]+@/);
  });
});

describe("where the terms page is reachable from", () => {
  it("is linked from the MCP docs and the privacy page", () => {
    expect(read("src/pages/docs/mcp.astro")).toContain('href="/terms"');
    expect(read("src/pages/privacy.astro")).toContain('href="/terms"');
  });

  it("is in the sitemap", () => {
    expect(read("src/pages/sitemap.xml.ts")).toContain('loc: "/terms"');
  });
});
