/**
 * tsconfig self-containment guard for GH-1232:
 *
 * A repo checkout that lives inside a dot-directory (e.g. `.worktrees/x`) could
 * not load a single test suite: the oxc/vite tsconfig loader resolves
 * `extends: "astro/tsconfigs/strict"` with a glob that never descends into
 * dot-directories, so the preset was unreachable and every transforming
 * worker died with `[TSCONFIG_ERROR] Failed to load tsconfig
 * 'astro/tsconfigs/strict': Tsconfig not found`.
 *
 * The fix is to keep the repository tsconfig self-contained: no package-path
 * `extends`, every compiler option the preset supplied inlined verbatim. These
 * tests pin that shape forever, so nobody reintroduces the package-path
 * extends, and so an Astro upgrade that moves an option is caught here rather
 * than by a loader that only fails in worktrees.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../..");

interface Tsconfig {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
  include?: string[];
  exclude?: string[];
}

const readTsconfig = (absolutePath: string): Tsconfig =>
  // Astro ships its presets as JSONC.
  JSON.parse(readFileSync(absolutePath, "utf-8").replace(/^\s*\/\/.*$/gm, ""));

const repo = () => readTsconfig(resolve(ROOT, "tsconfig.json"));

/**
 * Options the repository deliberately overrides relative to the Astro preset
 * (the web app compiles React, the preset preserves JSX for `.astro` files).
 */
const REPO_OVERRIDES = new Set(["jsx"]);

describe("tsconfig.json is self-contained (GH-1232)", () => {
  it("does not extend a package path out of node_modules", () => {
    expect(repo().extends, "tsconfig.json must not extend a package path").toBeUndefined();
  });

  it("inlines every compiler option from the astro strict preset", () => {
    const base = readTsconfig(resolve(ROOT, "node_modules/astro/tsconfigs/base.json"));
    const strict = readTsconfig(resolve(ROOT, "node_modules/astro/tsconfigs/strict.json"));
    const preset: Record<string, unknown> = {
      ...base.compilerOptions,
      ...strict.compilerOptions,
    };

    const compilerOptions = repo().compilerOptions ?? {};
    for (const [option, value] of Object.entries(preset)) {
      if (REPO_OVERRIDES.has(option)) continue;
      expect(compilerOptions, `compilerOption "${option}" must stay inline`).toHaveProperty(
        option,
        value,
      );
    }
  });

  it("keeps type-checking the Astro generated types the preset included", () => {
    // Dropping the preset's `include` silently stops type-checking the file
    // Astro regenerates on every `astro dev`/`astro build`.
    expect(repo().include).toContain(".astro/types.d.ts");
  });

  it("keeps the strict flags on", () => {
    expect(repo().compilerOptions).toHaveProperty("strict", true);
  });
});
