/**
 * The extract-zip audit exemption must stay honest (GH-1126).
 *
 * `extract-zip <= 2.0.1` carries two high-severity advisories — symlink path
 * traversal / arbitrary file writes (GHSA-jmr9-qjv8-65gv = CVE-2026-56876 and
 * GHSA-7pqw-9j4j-h8q3 = CVE-2026-19693). No patched version has ever been
 * published: `first_patched_version` is null on both advisories and 2.0.1 is
 * still npm's `latest`, so an override cannot be written — pnpm has nothing to
 * resolve it to. The chain is dev-only (@lhci/cli -> lighthouse ->
 * puppeteer-core -> @puppeteer/browsers), but the audit gate covers dev
 * dependencies, so the alerts were silenced with `auditConfig.ignoreGhsas`.
 *
 * An ignored advisory is invisible: the moment 2.0.2 ships, the ignore keeps
 * the alert silenced forever and nobody is asked to migrate. This test is the
 * ratchet on that silence — it asserts the exemption exists with a dated,
 * specific reason while the patched version is unpublished, and that the
 * exemption is dropped (and the override added) the moment the lockfile
 * resolves a patched extract-zip. It must not be relaxed to pass.
 *
 * Honest limit: this pins the dependency graph, not runtime safety. extract-zip
 * only runs inside puppeteer's browser installer, never in our code, so no test
 * here exercises the traversal itself — the repair is upstream's.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const PACKAGE = "extract-zip";
/** First version that is not covered by either advisory's `<= 2.0.1` range. */
const PATCHED_VERSION = "2.0.2";

const IGNORED_GHSAS = [
  "GHSA-jmr9-qjv8-65gv",
  "GHSA-7pqw-9j4j-h8q3",
] as const;
const CVES = ["CVE-2026-56876", "CVE-2026-19693"] as const;

interface WorkspaceFile {
  overrides?: Record<string, string>;
  auditConfig?: { ignoreGhsas?: unknown };
}

const workspaceRaw = read("pnpm-workspace.yaml");
const lockRaw = read("pnpm-lock.yaml");
const workspace = parseYaml(workspaceRaw) as WorkspaceFile;
const lock = parseYaml(lockRaw) as { packages?: Record<string, unknown> };

const ignoredGhsas: unknown = workspace.auditConfig?.ignoreGhsas;
const ignoredEntries: string[] = Array.isArray(ignoredGhsas)
  ? ignoredGhsas.filter((id): id is string => typeof id === "string")
  : [];

/**
 * The comment block that sits above the `ignoreGhsas` list. YAML parsing drops
 * comments, so the justification is read from the raw file — which is the only
 * place a reason can be recorded at all.
 */
const auditCommentBlock = ((): string => {
  const lines = workspaceRaw.split("\n");
  const start = lines.findIndex((l) => /^auditConfig:/.test(l));
  if (start === -1) return "";
  return lines
    .slice(start + 1)
    .filter((l) => /^\s*#/.test(l))
    .join("\n");
})();

/** Versions of `extract-zip` the lockfile actually resolves. */
const resolvedVersions = Object.keys(lock.packages ?? {})
  .map((key) => key.match(new RegExp(`^${PACKAGE}@([0-9][^(]*)$`))?.[1])
  .filter((v): v is string => v !== undefined)
  .sort();

const compareVersions = (a: string, b: string): number => {
  const parts = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10));
  const [aParts, bParts] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const unpatchedVersions = resolvedVersions.filter(
  (v) => compareVersions(v, PATCHED_VERSION) < 0,
);
/**
 * The lockfile still resolves a version covered by the advisories, so the
 * exemption is still load-bearing. Flips on its own when 2.0.2 publishes (or
 * the dependency escapes the graph) — which is what turns the assertions below
 * from "keep the exemption" into "the exemption is stale, remove it".
 */
const exemptionStillNeeded = unpatchedVersions.length > 0;

const extractZipOverrides = Object.keys(workspace.overrides ?? {}).filter((k) =>
  k.startsWith(`${PACKAGE}@`),
);

describe("extract-zip audit exemption (GH-1126)", () => {
  it("exposes extract-zip only through dev tooling, never through runtime deps", () => {
    // The premise the exemption rests on: extract-zip runs inside puppeteer's
    // browser installer, so if it ever becomes a runtime dependency the
    // "dev-only, ignored" reasoning stops holding and this fails.
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain(PACKAGE);
  });

  it("ignores exactly the two extract-zip advisories and nothing else", () => {
    // A dated exemption for two known advisories is auditable; a growing list
    // is where unreviewed "dev-only, ignore" decisions accumulate. Every entry
    // must also be a well-formed GHSA id, so a typo cannot silently fail to
    // match any advisory while appearing to silence one.
    for (const entry of ignoredEntries) {
      expect(entry).toMatch(/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/);
    }
    expect([...ignoredEntries].sort()).toEqual(
      exemptionStillNeeded ? [...IGNORED_GHSAS].sort() : [],
    );
  });

  it("keeps a dated, specific justification for each ignored advisory", () => {
    if (!exemptionStillNeeded) return;
    for (const ghsa of IGNORED_GHSAS) {
      expect(auditCommentBlock).toContain(ghsa);
    }
    for (const cve of CVES) {
      expect(auditCommentBlock).toContain(cve);
    }
    // Dated, so a stale exemption is visible without git archaeology.
    expect(auditCommentBlock).toMatch(/\b20\d\d-\d\d-\d\d\b/);
    // The reason and the escape route, both of which a future reader needs.
    expect(auditCommentBlock).toMatch(/dev-only/i);
    expect(auditCommentBlock).toContain(PATCHED_VERSION);
    expect(auditCommentBlock).toMatch(
      /extract-zip@<=2\.0\.1: '>=2\.0\.2'/,
    );
    expect(auditCommentBlock).toMatch(/remove/i);
  });

  it("carries no extract-zip override while that override cannot resolve", () => {
    // 2.0.2 does not exist on npm, so `extract-zip@<=2.0.1: '>=2.0.2'` would
    // make `pnpm install` fail outright. Asserting its absence keeps the
    // exemption-as-ignore from being swapped for an un-resolvable pin.
    if (!exemptionStillNeeded) return;
    expect(extractZipOverrides).toEqual([]);
  });

  it("drops the exemption once a patched extract-zip is resolved", () => {
    // While the lockfile resolves an unpatched version both ids stay ignored;
    // the moment it resolves 2.0.2 (or extract-zip leaves the graph entirely)
    // they must go, and a patched resolution must be backed by the override
    // rather than by another silence.
    if (exemptionStillNeeded) {
      expect(
        ignoredEntries,
        `lockfile still resolves unpatched extract-zip (${resolvedVersions.join(", ")}); both advisory ids must stay ignored until a patched version is resolved`,
      ).toEqual(expect.arrayContaining([...IGNORED_GHSAS]));
      return;
    }

    expect(
      ignoredEntries,
      "a patched extract-zip is resolved (or gone from the lockfile) — remove both ids from auditConfig.ignoreGhsas; the override below replaces them",
    ).not.toEqual(expect.arrayContaining([...IGNORED_GHSAS]));
    if (resolvedVersions.length > 0) {
      expect(
        extractZipOverrides,
        "override pins extract-zip to the patched line",
      ).toEqual([`${PACKAGE}@<=2.0.1`]);
    }
  });
});
