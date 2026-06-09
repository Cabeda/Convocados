/**
 * Generate docs/feature-parity.md from feature-parity.yaml
 *
 * Usage: npx tsx scripts/generate-feature-parity-docs.ts
 */
import { readFileSync, writeFileSync } from "fs";
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
writeFileSync(resolve(ROOT, "docs/feature-parity.md"), output);
console.log("✓ Generated docs/feature-parity.md");
