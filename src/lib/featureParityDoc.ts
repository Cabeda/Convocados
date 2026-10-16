/**
 * Rendering for `docs/feature-parity.md`, kept pure and out of the CLI so a test
 * can compare the committed doc against the manifest without spawning anything.
 *
 * `scripts/generate-feature-parity-docs.ts` is the thin CLI: read + parse the
 * YAML, render here, then write or compare. The split exists because the check
 * has to be testable without a subprocess — `npx tsx` exits 127 on the runner and
 * `pnpm` inside a test worker exits 1 there, so both attempts at a CLI test
 * failed for reasons that had nothing to do with the check.
 */

/** A parsed `feature-parity.yaml`: feature → platforms, plus optional capabilities. */
export type FeatureParityManifest = Record<string, Record<string, unknown>>;

function icon(value: boolean): string {
  return value ? "✅" : "❌";
}

function kebabToTitle(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The exact bytes `docs/feature-parity.md` should contain. */
export function renderFeatureParityDoc(manifest: FeatureParityManifest): string {
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

  return lines.join("\n");
}
