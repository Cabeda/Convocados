/**
 * The dependency-audit exemptions, pinned (GH-1126).
 *
 * `pnpm audit --audit-level high` exits 0 only because the open extract-zip
 * advisories sit in `auditConfig.ignoreGhsas`. An exemption is a decision, not
 * a default: it has to name the advisories it covers, say why the exposure is
 * acceptable, and carry a review date — otherwise it outlives the reasoning
 * that justified it and nobody ever re-reads it.
 *
 * The two live advisories are Dependabot #266 (GHSA-7pqw-9j4j-h8q3,
 * CVE-2026-19693) and #256 (GHSA-jmr9-qjv8-65gv, CVE-2026-56876): both high,
 * development scope, range <= 2.0.1, first_patched_version null. No patched
 * build exists (`npm view extract-zip dist-tags` → latest 2.0.1), so an
 * override cannot resolve and the exemption is the only honest option short of
 * a lighthouse major bump.
 *
 * Honest limit: this pins governance, not runtime safety. extract-zip is
 * reached only through @lhci/cli -> lighthouse -> puppeteer-core ->
 * @puppeteer/browsers — dev tooling — so nothing in the server render path
 * executes it and no test here exercises the traversal. The repair is
 * upstream's; this guard is the ratchet on the exemption until it ships.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

interface OpenAdvisory {
  /** npm package the advisory is filed against. */
  package: string;
  /** GitHub advisory id, as Dependabot names it. */
  ghsa: string;
  cve: string;
  /** `security_vulnerability.vulnerable_version_range`. */
  vulnerableRange: string;
  /** `security_vulnerability.first_patched_version`; null while unpublished. */
  firstPatched: string | null;
}

/**
 * Every open high-severity advisory in the lockfile graph, mirrored from
 * `gh api repos/Cabeda/Convocados/dependabot/alerts?state=open`.
 *
 * `pnpm audit` needs the network, so this table is the source of truth the
 * guard checks against. That is exactly why it must be updated in the same
 * change that touches the audit config: `pnpm audit` prints the high count to
 * compare it with, and an advisory missing here fails the "not on the list"
 * guard below.
 */
const OPEN_HIGH_ADVISORIES: OpenAdvisory[] = [
  {
    package: "extract-zip",
    ghsa: "GHSA-7pqw-9j4j-h8q3",
    cve: "CVE-2026-19693",
    vulnerableRange: "<= 2.0.1",
    firstPatched: null,
  },
  {
    package: "extract-zip",
    ghsa: "GHSA-jmr9-qjv8-65gv",
    cve: "CVE-2026-56876",
    vulnerableRange: "<= 2.0.1",
    firstPatched: null,
  },
];

const workspaceRaw = read("pnpm-workspace.yaml");
const workspace = parseYaml(workspaceRaw) as {
  overrides?: Record<string, string>;
  auditConfig?: { ignoreGhsas?: string[] };
};
const overrides = workspace.overrides ?? {};
const ignoreGhsas = workspace.auditConfig?.ignoreGhsas ?? [];

// pnpm's YAML parser drops comments, so the justification lives in raw text.
const auditConfigAt = workspaceRaw.indexOf("auditConfig:");
const exemptionComment =
  auditConfigAt === -1
    ? ""
    : workspaceRaw
        .slice(auditConfigAt)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("#"))
        .join("\n");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Only the `snapshots:` half of the lockfile records the resolved graph, so a
// scan there cannot wander into the `packages:` resolution catalogue.
const snapshotsAt = read("pnpm-lock.yaml").lastIndexOf("\nsnapshots:");
const graph = snapshotsAt === -1 ? "" : read("pnpm-lock.yaml").slice(snapshotsAt);

/** The version pnpm resolved for a package, or null when it left the graph. */
const resolvedVersion = (name: string) =>
  new RegExp(`^ {2}'?${escapeRegExp(name)}@([^'\\n]*)'?:$`, "m").exec(graph)?.[1] ?? null;

/** One package's snapshot block, so a scan for a dependency stays inside it. */
const snapshotBlock = (name: string) => {
  const match = new RegExp(`^ {2}'?${escapeRegExp(name)}@[^'\\n]*'?:$`, "m").exec(graph);
  if (!match) return null;
  const rest = graph.slice(match.index + match[0].length);
  const next = /^ {2}\S/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
};

const lockfileDependsOn = (dependent: string, dependency: string) =>
  (snapshotBlock(dependent) ?? "").includes(`\n      ${dependency}:`);

const compareVersions = (a: string, b: string) => {
  const [aMaj, aMin, aPatch] = a.split(".").map(Number);
  const [bMaj, bMin, bPatch] = b.split(".").map(Number);
  return aMaj - bMaj || aMin - bMin || aPatch - bPatch;
};

const rangeCovers = (range: string, version: string) => {
  const upper = /^<=\s*(\d+\.\d+\.\d+)$/.exec(range)?.[1];
  if (!upper) throw new Error(`unhandled vulnerable_version_range: ${range}`);
  return compareVersions(version, upper) <= 0;
};

const parseIsoDay = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const REVIEWED_PATTERN = /reviewed[^\n]*?(\d{4}-\d{2}-\d{2})/i;
const RE_REVIEW_PATTERN = /re-?review by[^\n]*?(\d{4}-\d{2}-\d{2})/i;
const today = new Date().toISOString().slice(0, 10);

describe("dependency audit governance (GH-1126)", () => {
  it("exempts every advisory upstream has not patched, and overrides none of them", () => {
    const unpatched = OPEN_HIGH_ADVISORIES.filter((advisory) => advisory.firstPatched === null);
    expect(unpatched.length).toBeGreaterThan(0);

    for (const advisory of unpatched) {
      expect(
        ignoreGhsas,
        `${advisory.ghsa} (${advisory.cve}) has no patched build — it must stay exempt`,
      ).toContain(advisory.ghsa);

      // An override pointing at an unpublished version cannot resolve, so the
      // two modes are mutually exclusive: d6aa70af and f6122b87 override
      // because a patched release exists, this one exempts because it does not.
      const unsatisfiable = Object.keys(overrides).filter((key) =>
        key.startsWith(`${advisory.package}@`),
      );
      expect(unsatisfiable).toEqual([]);
    }
  });

  it("ignores no advisory that is off the open-high list or already patched", () => {
    expect(ignoreGhsas.length).toBeGreaterThan(0);

    for (const ghsa of ignoreGhsas) {
      const advisory = OPEN_HIGH_ADVISORIES.find((candidate) => candidate.ghsa === ghsa);
      expect(advisory, `${ghsa} is ignored but is not an open high-severity advisory`).toBeTruthy();
      expect(
        advisory!.firstPatched,
        `${advisory!.package} ${advisory!.firstPatched} is patched — drop the ignore and override instead`,
      ).toBeNull();
    }
  });

  it("anchors each exemption to the package, GHSA ids and CVEs it covers", () => {
    for (const ghsa of ignoreGhsas) {
      const advisory = OPEN_HIGH_ADVISORIES.find((candidate) => candidate.ghsa === ghsa)!;
      expect(exemptionComment).toContain(ghsa);
      expect(exemptionComment).toContain(advisory.cve);
      expect(exemptionComment).toContain(advisory.package);
    }
  });

  it("dates the exemption with a review date and a re-review deadline", () => {
    const reviewed = REVIEWED_PATTERN.exec(exemptionComment);
    expect(reviewed, "the exemption must record when it was last reviewed").toBeTruthy();
    const reviewedOn = parseIsoDay(reviewed![1]);
    expect(reviewedOn, `${reviewed![1]} is not a real calendar date`).toBe(reviewed![1]);
    expect(
      reviewedOn! <= today,
      `review date ${reviewed![1]} is in the future — record the review that happened`,
    ).toBe(true);

    const reReview = RE_REVIEW_PATTERN.exec(exemptionComment);
    expect(reReview, "the exemption must say when it is next re-reviewed").toBeTruthy();
    const reReviewBy = parseIsoDay(reReview![1]);
    expect(reReviewBy, `${reReview![1]} is not a real calendar date`).toBe(reReview![1]);
    expect(
      reReviewBy! > today,
      `re-review deadline ${reReview![1]} has passed — re-review the exemption or override instead`,
    ).toBe(true);
  });

  it("justifies the exemption with the chain that reaches it, and the lockfile agrees", () => {
    // The reason has to be written down, not held in a reviewer's memory.
    expect(exemptionComment).toMatch(/dev/i);
    expect(exemptionComment).toMatch(/@lhci/);
    expect(exemptionComment).toMatch(/puppeteer/i);

    // ...and it has to be true of the graph, or the reason is a fiction.
    expect(lockfileDependsOn("@puppeteer/browsers", "extract-zip")).toBe(true);
    for (const advisory of OPEN_HIGH_ADVISORIES) {
      const resolved = resolvedVersion(advisory.package);
      expect(resolved, `${advisory.package} left the graph — is the exemption stale?`).toBeTruthy();
      expect(rangeCovers(advisory.vulnerableRange, resolved!)).toBe(true);
    }

    // Dev-only claim: the entry point is a devDependency, so nothing in the
    // production dependency set can reach the vulnerable package.
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@lhci/cli"]).toBeUndefined();
    expect(pkg.devDependencies?.["@lhci/cli"]).toBeDefined();
  });
});
