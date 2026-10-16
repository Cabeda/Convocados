/**
 * Generate docs/feature-parity.md from feature-parity.yaml
 *
 * Usage:
 *   npx tsx scripts/generate-feature-parity-docs.ts           # write the doc
 *   npx tsx scripts/generate-feature-parity-docs.ts --check    # fail if it is stale
 *
 * `--check` exists because a gate that regenerates the file it is checking can
 * never report that the file was wrong: it repairs the drift and exits 0. The
 * gate in `scripts/factory/gate.sh` calls `--check`; the write path stays for
 * the human command that intentionally updates the doc.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { parse } from "yaml";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const manifest = parse(
  readFileSync(resolve(ROOT, "feature-parity.yaml"), "utf-8"),
) as Record<string, Record<string, unknown>>;

function icon(v: boolean): string {
  return v ? "✅" : "❌";
}

function kebabToTitle(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const lines: string[] = [
  "# Feature Parity",
  "",
  "> Auto-generated from `feature-parity.yaml` — do not edit manually.",
  "",
  "## Overview",
  "",
  "| Feature | Web | Android | Wear OS |",
  "|---------|:---:|:-------:|:-------:|",
];

for (const [feature, entry] of Object.entries(manifest)) {
  lines.push(
    `| **${kebabToTitle(feature)}** | ${icon(entry.web as boolean)} | ${icon(entry.android as boolean)} | ${icon(entry.wearos as boolean)} |`,
  );
}

lines.push("", "## Detailed Capabilities", "");

for (const [feature, entry] of Object.entries(manifest)) {
  if (!entry.capabilities || typeof entry.capabilities !== "object") continue;
  const caps = entry.capabilities as Record<string, Record<string, boolean>>;
  lines.push(`### ${kebabToTitle(feature)}`, "");
  lines.push("| Capability | Web | Android | Wear OS |");
  lines.push("|------------|:---:|:-------:|:-------:|");
  for (const [cap, platforms] of Object.entries(caps)) {
    lines.push(
      `| ${kebabToTitle(cap)} | ${icon(platforms.web)} | ${icon(platforms.android)} | ${icon(platforms.wearos)} |`,
    );
  }
  lines.push("");
}

const output = lines.join("\n");
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
