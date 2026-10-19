import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { renderFeatureParityDoc, type FeatureParityManifest } from "~/lib/featureParityDoc";

/**
 * The feature-parity gate.
 *
 * Before this, the "gate" in `scripts/factory/gate.sh` ran a **generator**: it
 * rewrote `docs/feature-parity.md` and exited 0 whether or not the committed file
 * was in date. Measured: stale the doc, run `pnpm sync:feature-parity-docs` →
 * exit 0. A gate that repairs the thing it is checking can never report that the
 * thing was broken.
 *
 * The check is `renderFeatureParityDoc(manifest) === readFileSync(doc)` — asserted
 * here against the real manifest and the real committed file, with no subprocess.
 * Two earlier versions of this test spawned the CLI and failed on CI for reasons
 * that had nothing to do with the check (`npx tsx` exits 127 there; `pnpm` inside
 * a test worker exits 1), which is why the rendering was extracted to
 * `src/lib/featureParityDoc.ts`.
 */
const ROOT = process.cwd();
const DOC = path.join(ROOT, "docs/feature-parity.md");
const YAML = path.join(ROOT, "feature-parity.yaml");

const manifest = parse(readFileSync(YAML, "utf-8")) as FeatureParityManifest;
const committed = readFileSync(DOC, "utf-8");

describe("the committed feature-parity doc is in date", () => {
  it("matches what the manifest renders, byte for byte", () => {
    // The gate's pass case, and the whole check: this single equality is what
    // `pnpm check:feature-parity` evaluates.
    expect(committed).toBe(renderFeatureParityDoc(manifest));
  });

  it("detects drift, so the gate has a failure to report", () => {
    expect(committed + "\n<!-- drift -->\n").not.toBe(renderFeatureParityDoc(manifest));
  });

  it("detects a manifest change, so a stale doc cannot pass", () => {
    const changed: FeatureParityManifest = {
      ...manifest,
      "a-feature-that-does-not-exist": { web: true, android: false, wearos: false },
    };
    expect(renderFeatureParityDoc(changed)).not.toBe(committed);
  });
});

describe("the rendering", () => {
  it("marks each platform with its own icon", () => {
    const rendered = renderFeatureParityDoc({ demo: { web: true, android: false, wearos: true } });
    expect(rendered).toContain("| **Demo** | ✅ | ❌ | ✅ |");
  });

  it("titles kebab-case features and capabilities for a reader", () => {
    const rendered = renderFeatureParityDoc({
      "some-feature": { web: true, android: true, wearos: true, capabilities: { "deep-link": { web: true, android: false, wearos: false } } },
    });
    expect(rendered).toContain("### Some Feature");
    expect(rendered).toContain("| Deep Link | ✅ | ❌ | ❌ |");
  });

  it("omits the capability section for a feature that has none", () => {
    const rendered = renderFeatureParityDoc({ demo: { web: true, android: true, wearos: true } });
    expect(rendered).not.toContain("### Demo");
  });
});
