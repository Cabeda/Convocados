import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const layout = readFileSync(resolve(__dirname, "../layouts/BaseLayout.astro"), "utf-8");

describe("BaseLayout — less motion means none", () => {
  it("ends every animation and transition in one frame under prefers-reduced-motion", () => {
    const block = layout.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{([^}]*)\}/);
    expect(block, "the global reduced-motion rule is missing").not.toBeNull();
    expect(block![1]).toContain("animation-duration: 0.01ms !important");
    expect(block![1]).toContain("transition-duration: 0.01ms !important");
    expect(block![1]).toContain("animation-iteration-count: 1 !important");
  });

  it("gives the one main landmark an id the skip link points at", () => {
    expect(layout).toMatch(/<main\s+id="main-content"/);
  });
});
