/**
 * Generate or verify docs/feature-parity.md from feature-parity.yaml
 *
 * Usage:
 *   tsx scripts/generate-feature-parity-docs.ts           # write the doc
 *   tsx scripts/generate-feature-parity-docs.ts --check    # fail if it is stale
 *
 * `--check` exists because a gate that regenerates the file it is checking can
 * never report that the file was wrong: it repairs the drift and exits 0. The
 * gate in `scripts/factory/gate.sh` and the pre-push hook call
 * `pnpm check:feature-parity`; the write path stays for the human command that
 * intentionally updates the doc.
 *
 * The rendering lives in `src/lib/featureParityDoc.ts` so it is testable without
 * a subprocess — see that file for why.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { parse } from "yaml";
import { renderFeatureParityDoc, type FeatureParityManifest } from "../src/lib/featureParityDoc";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const manifest = parse(
  readFileSync(resolve(ROOT, "feature-parity.yaml"), "utf-8"),
) as FeatureParityManifest;

const output = renderFeatureParityDoc(manifest);
const target = resolve(ROOT, "docs/feature-parity.md");

if (process.argv.includes("--check")) {
  const committed = existsSync(target) ? readFileSync(target, "utf-8") : "";
  if (committed !== output) {
    console.error("✗ docs/feature-parity.md is out of date with feature-parity.yaml.");
    console.error("  Run `pnpm sync:feature-parity-docs` and commit the result.");
    process.exit(1);
  }
  console.log("✓ docs/feature-parity.md is up to date");
} else {
  writeFileSync(target, output);
  console.log("✓ Generated docs/feature-parity.md");
}
