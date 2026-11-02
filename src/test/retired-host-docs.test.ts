/**
 * `convocados.fly.dev` is retired: the server redirects it to
 * `convocados.cabeda.dev` (301 for navigations, 308 for mutations). Teaching it
 * as the base URL is worse than a harmless hop — a `curl` prints an empty 308
 * body, and following the redirect cross-host drops `Authorization`.
 *
 * The one deliberate reference left is `trustedOrigins` in auth.server.ts, so an
 * in-flight OAuth round-trip still completes after the redirect. A source comment
 * explaining the retirement is also fine; a *document* that tells someone to use
 * the host is not.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const RETIRED = "convocados.fly.dev";

function filesUnder(dir: string, extensions: string[]): string[] {
  const entries = readdirSync(path.join(root, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // ADRs are historical records: they may name a host that was current when
      // the decision was written. They are not instructions anyone follows.
      if (rel === path.join("docs", "adr")) continue;
      files.push(...filesUnder(rel, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(rel);
    }
  }
  return files;
}

describe("documentation teaches the canonical host", () => {
  const surfaces = [
    ...filesUnder(path.join("src", "pages", "docs"), [".astro"]),
    ...filesUnder("docs", [".md"]),
    ...filesUnder(path.join("android-app", "wear", "src", "androidTest"), [".kt"]),
    "TODO.md",
    path.join("scripts", "fast-deploy.sh"),
  ];

  it("owns every file the retired host appeared in", () => {
    // A guard against the walker silently matching nothing (a renamed directory
    // would otherwise turn this whole file green without checking anything).
    expect(surfaces.length).toBeGreaterThan(50);
  });

  it("never names the retired host", () => {
    const offenders = surfaces.filter((file) => read(file).includes(RETIRED));
    expect(offenders, `still teaches ${RETIRED}`).toEqual([]);
  });

  it("documents the canonical API base URL", () => {
    expect(read(path.join("src", "pages", "docs", "api", "index.astro"))).toContain(
      "https://convocados.cabeda.dev",
    );
  });
});
