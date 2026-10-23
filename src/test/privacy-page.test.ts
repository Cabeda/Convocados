import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("privacy policy page", () => {
  const page = read("src/pages/privacy.astro");

  it("states every topic the directory requires", () => {
    // A listing is rejected when its privacy policy is incomplete, so the
    // sections are pinned rather than left to reviewer taste.
    for (const heading of [
      "What we collect",
      "Why we use it",
      "Who processes it",
      "How long we keep it",
      "Cookies",
      "Contact",
    ]) {
      expect(page, `missing "${heading}"`).toContain(`<h2>${heading}</h2>`);
    }
  });

  it("names the export and deletion paths it promises", () => {
    expect(page).toContain("/api/me/export");
    expect(page).toContain("DELETE /api/me/account");
  });

  it("gives a reachable contact address", () => {
    expect(page).toMatch(/mailto:[^"]+@/);
  });
});

describe("MCP docs", () => {
  const docs = read("src/pages/docs/mcp.astro");

  it("tells a user how to connect in Claude, not only how the endpoint works", () => {
    expect(docs).toContain("Add custom connector");
    expect(docs).toContain("https://convocados.cabeda.dev/api/mcp");
    expect(docs).toContain("sign in with the Convocados account");
  });

  it("links the privacy policy", () => {
    expect(docs).toContain('href="/privacy"');
  });
});
