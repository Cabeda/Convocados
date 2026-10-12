/**
 * The dependency-audit exemptions, pinned (GH-1126).
 *
 * `pnpm audit --audit-level high` exits 0 only because the open extract-zip
 * advisories sit in `auditConfig.ignoreGhsas`. An exemption is a decision, not
 * a default: it has to name the advisories it covers, say why the exposure is
 * acceptable, and carry a review date — otherwise it outlives the reasoning
 * that justified it and nobody ever re-reads it.
 *
 * Where the advisory set comes from: `pnpm audit --json --audit-level high`,
 * spawned from this test. Run against the project as configured, pnpm filters
 * out everything `auditConfig.ignoreGhsas` declares, so what it prints is the
 * set of advisories *nobody* exempted — that is the gate. To see the ignored
 * ones as well, the test spawns the same command against a scratch copy of
 * `pnpm-workspace.yaml` with its `auditConfig` block removed and the repo's own
 * lockfile symlinked in.
 *
 * What this guard guarantees, then:
 *   - The project's own audit reports nothing at high severity or above. A
 *     fresh high advisory with no exemption lands in that set, so the suite
 *     goes red the moment one appears — the guarantee the old hand-mirrored
 *     table only pretended to make.
 *   - Every advisory the audit names (ignores removed) is either resolved by an
 *     `overrides` entry that pins the package above the vulnerable range, or
 *     carried by `auditConfig.ignoreGhsas`.
 *   - No `ignoreGhsas` entry is stale: one the advisory set no longer names, or
 *     that an override already resolves, fails here. The exemption list and the
 *     advisory set are exactly the same set.
 *   - Each exemption comment anchors the package, the GHSA id and the CVE it
 *     covers, states the chain that reaches it, and carries a review date that
 *     is not in the future plus a re-review deadline that has not passed.
 *
 * What it does not guarantee: that the vulnerable code is unreachable from the
 * server runtime (that claim is asserted against the graph below, so it is a
 * property of the graph, not of the advisory), or that the exposure is small —
 * only that somebody wrote down that it exists, why it is acceptable, and when
 * they will look again.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

interface AuditAdvisory {
  /** GitHub advisory id, as the audit's `github_advisory_id` names it. */
  ghsa: string;
  /** npm package the advisory is filed against. */
  package: string;
  severity: string;
  /** `vulnerable_versions`, e.g. "<= 2.0.1". */
  vulnerableRange: string;
  /** True when the finding sits in the dev/optional graph. */
  dev: boolean;
}

/** Severities the audit is run for; anything else is out of scope. */
const HIGH_OR_WORSE = new Set(["high", "critical"]);

const describeAdvisory = (advisory: AuditAdvisory) =>
  `${advisory.ghsa} (${advisory.package} ${advisory.vulnerableRange}, ${advisory.severity})`;

/**
 * Runs `pnpm audit --json --audit-level high` in [cwd] and parses stdout.
 *
 * pnpm exits non-zero as soon as it finds an advisory, so the exit code says
 * nothing about success: the JSON on stdout is the only signal, and its
 * absence is a failure, never an empty result.
 */
function runAudit(cwd: string): { advisories: AuditAdvisory[]; highCount: number } {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpm, ["audit", "--json", "--audit-level", "high"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout?.trim() ?? "";
  if (!stdout.startsWith("{")) {
    throw new Error(
      `pnpm audit printed no JSON in ${cwd} (exit ${result.status}): ${result.stderr?.slice(0, 500)}`,
    );
  }
  const parsed = JSON.parse(stdout) as {
    advisories: Record<string, Advisory>;
    metadata: { vulnerabilities: Record<string, number> };
  };
  return {
    advisories: Object.values(parsed.advisories).map((advisory) => ({
      ghsa: String(advisory.github_advisory_id),
      package: String(advisory.module_name),
      severity: String(advisory.severity),
      vulnerableRange: String(advisory.vulnerable_versions),
      dev: Boolean(advisory.findings?.[0]?.dev),
    })),
    highCount: parsed.metadata.vulnerabilities.high ?? 0,
  };
}

interface Advisory {
  github_advisory_id: string;
  module_name: string;
  severity: string;
  vulnerable_versions: string;
  findings?: { dev: boolean }[];
}

/** pnpm's YAML parser drops comments, so the justification lives in raw text. */
const stripAuditConfig = (raw: string) => {
  const at = raw.indexOf("auditConfig:");
  return at === -1 ? raw : raw.slice(0, at);
};

/**
 * The advisory set with the exemptions taken out, so ignored advisories are
 * visible. A scratch directory only: the repo's own workspace file is never
 * edited, and the lockfile is symlinked so the audit reads the real graph.
 */
function advisoriesWithoutExemptions(): AuditAdvisory[] {
  const dir = mkdtempSync(resolve(tmpdir(), "convocados-audit-"));
  try {
    writeFileSync(resolve(dir, "pnpm-workspace.yaml"), stripAuditConfig(workspaceRaw));
    copyFileSync(resolve(root, "package.json"), resolve(dir, "package.json"));
    symlinkSync(resolve(root, "pnpm-lock.yaml"), resolve(dir, "pnpm-lock.yaml"));
    return runAudit(dir).advisories;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const workspaceRaw = read("pnpm-workspace.yaml");
const workspace = parseYaml(workspaceRaw) as {
  overrides?: Record<string, string>;
  auditConfig?: { ignoreGhsas?: string[] };
};
const overrides = workspace.overrides ?? {};
const ignoreGhsas = workspace.auditConfig?.ignoreGhsas ?? [];

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

/** The inclusive ceiling of a `<= X` / `< X` range, or null for other shapes. */
const vulnerableCeiling = (range: string) => /^<=?\s*(\d+\.\d+\.\d+)$/.exec(range.trim())?.[1] ?? null;

/** The floor an `overrides` value pins to: `'>=6.2.1'` → "6.2.1". */
const overrideFloor = (value: string) => /(?:^|[><=]*\s*)>=?\s*(\d+\.\d+\.\d+)/.exec(value)?.[1] ?? null;

/**
 * Whether an `overrides` entry already resolves this advisory by pinning the
 * package above the vulnerable range — in which case the registry stops
 * reporting it and no exemption is needed.
 */
function overrideResolves(advisory: AuditAdvisory, overrides: Record<string, string>): boolean {
  const ceiling = vulnerableCeiling(advisory.vulnerableRange);
  if (ceiling === null) return false;
  return Object.entries(overrides).some(([key, value]) => {
    if (key !== advisory.package && !key.startsWith(`${advisory.package}@`)) return false;
    const floor = overrideFloor(String(value));
    return floor !== null && compareVersions(floor, ceiling) > 0;
  });
}

/** How an advisory is accounted for, or "none" when nobody has decided anything. */
export function exemptionFor(
  advisory: AuditAdvisory,
  options: { overrides: Record<string, string>; ignoreGhsas: string[] },
): "override" | "ignore" | "none" {
  if (options.ignoreGhsas.includes(advisory.ghsa)) return "ignore";
  if (overrideResolves(advisory, options.overrides)) return "override";
  return "none";
}

/** The high-or-worse advisories nobody has made a decision about. */
export function unexemptedAdvisories(
  advisories: AuditAdvisory[],
  options: { overrides: Record<string, string>; ignoreGhsas: string[] },
): AuditAdvisory[] {
  return advisories
    .filter((advisory) => HIGH_OR_WORSE.has(advisory.severity))
    .filter((advisory) => exemptionFor(advisory, options) === "none");
}

/** The CVEs the advisories map to, so a comment can be anchored to both ids. */
const ADVISORY_CVES: Record<string, string> = {
  "GHSA-7pqw-9j4j-h8q3": "CVE-2026-19693",
  "GHSA-jmr9-qjv8-65gv": "CVE-2026-56876",
};

const parseIsoDay = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const REVIEWED_PATTERN = /reviewed[^\n]*?(\d{4}-\d{2}-\d{2})/i;
const RE_REVIEW_PATTERN = /re-?review by[^\n]*?(\d{4}-\d{2}-\d{2})/i;
const today = new Date().toISOString().slice(0, 10);

// The same command with the exemptions removed, so the ignored advisories are
// visible too. Read once: the network round trip is the slow part of this file.
const all = advisoriesWithoutExemptions();
const options = { overrides, ignoreGhsas };

describe("dependency audit governance (GH-1126)", () => {
  // The project's own audit: everything `auditConfig.ignoreGhsas` already
  // covers is filtered out, so this set is "advisories nobody exempted".
  const live = runAudit(root);

  it("reports nothing at high severity once the exemptions are applied", () => {
    const unexempted = live.advisories.filter((advisory) => HIGH_OR_WORSE.has(advisory.severity));
    expect(
      unexempted.map(describeAdvisory),
      "a high advisory is open and exempted by nobody: resolve it with an override, " +
        "or add a dated ignoreGhsas entry that names it",
    ).toEqual([]);
    expect(live.highCount).toBe(all.filter((advisory) => advisory.severity === "high").length);
  });

  it("exempts every high advisory the overrides do not resolve", () => {
    expect(all.length).toBeGreaterThan(0);
    expect(
      unexemptedAdvisories(all, options).map(describeAdvisory),
      "the registry still reports these and neither an override nor an ignoreGhsas entry covers them",
    ).toEqual([]);
  });

  it("ignores no advisory that is not open, not high, or already overridden", () => {
    expect(ignoreGhsas.length).toBeGreaterThan(0);

    for (const ghsa of ignoreGhsas) {
      const advisory = all.find((candidate) => candidate.ghsa === ghsa);
      expect(advisory, `${ghsa} is ignored but the audit no longer reports it`).toBeTruthy();
      expect(
        HIGH_OR_WORSE.has(advisory!.severity),
        `${ghsa} is ${advisory!.severity}, not high — drop the ignore and resolve it instead`,
      ).toBe(true);
      expect(
        overrideResolves(advisory!, overrides),
        `${advisory!.package} is already pinned past the vulnerable range — drop the ignore and let the override resolve it`,
      ).toBe(false);
    }

    // The exemption list and the advisory set are the same set: no spare entry,
    // and no advisory somebody quietly kept without writing the decision down.
    expect([...ignoreGhsas].sort()).toEqual(all.map((advisory) => advisory.ghsa).sort());
  });

  it("anchors each exemption to the package, GHSA ids and CVEs it covers", () => {
    expect(all.length).toBeGreaterThan(0);

    for (const advisory of all) {
      expect(exemptionComment, `${advisory.ghsa} is exempt without being named`).toContain(advisory.ghsa);
      expect(exemptionComment).toContain(advisory.package);
      const cve = ADVISORY_CVES[advisory.ghsa];
      if (cve) expect(exemptionComment, `${advisory.ghsa} must be anchored to ${cve}`).toContain(cve);
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
    for (const advisory of all) {
      const resolved = resolvedVersion(advisory.package);
      expect(resolved, `${advisory.package} left the graph — is the exemption stale?`).toBeTruthy();
      const ceiling = vulnerableCeiling(advisory.vulnerableRange);
      expect(ceiling, `unhandled vulnerable_version_range: ${advisory.vulnerableRange}`).toBeTruthy();
      // The lockfile still resolves inside the vulnerable range, which is why
      // the exemption exists: nothing has moved it out.
      expect(
        compareVersions(resolved!, ceiling!) <= 0,
        `${advisory.package} resolves ${resolved}, outside ${advisory.vulnerableRange} — ` +
          "the advisory should no longer be open",
      ).toBe(true);
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

// ── the classification, on its own ──────────────────────────────────────

/** An advisory the registry could plausibly hand back, for the negative cases. */
function fakeAdvisory(overrides: Partial<AuditAdvisory> = {}): AuditAdvisory {
  return {
    ghsa: "GHSA-zzzz-zzzz-zzzz",
    package: "extract-zip",
    severity: "high",
    vulnerableRange: "<= 2.0.1",
    dev: true,
    ...overrides,
  };
}

describe("exemptionFor", () => {
  it("accounts for an advisory an override pins past the vulnerable range", () => {
    const advisory = fakeAdvisory({ ghsa: "GHSA-aaaa-aaaa-aaaa" });
    expect(exemptionFor(advisory, { overrides: { "extract-zip": ">=2.0.2" }, ignoreGhsas: [] })).toBe(
      "override",
    );
  });

  it("accounts for an advisory the ignore list carries", () => {
    const advisory = fakeAdvisory({ ghsa: "GHSA-bbbb-bbbb-bbbb" });
    expect(exemptionFor(advisory, { overrides: {}, ignoreGhsas: ["GHSA-bbbb-bbbb-bbbb"] })).toBe(
      "ignore",
    );
  });

  it("flags an advisory that nobody has decided anything about", () => {
    const advisory = fakeAdvisory({ ghsa: "GHSA-cccc-cccc-cccc" });
    expect(exemptionFor(advisory, { overrides: {}, ignoreGhsas: [] })).toBe("none");
  });

  it("reports an injected high advisory into the set the guard checks", () => {
    // The negative case for the real assertions: a brand-new high advisory
    // with no exemption is reported, not quietly dropped.
    const injected = fakeAdvisory({ ghsa: "GHSA-cccc-cccc-cccc", package: "left-pad" });
    expect(unexemptedAdvisories([...all, injected], options)).toEqual([injected]);
  });

  it("does not report an injected advisory that carries an exemption", () => {
    const ignored = fakeAdvisory({ ghsa: "GHSA-cccc-cccc-cccc", package: "left-pad" });
    const overridden = fakeAdvisory({ ghsa: "GHSA-dddd-dddd-dddd", package: "extract-zip" });
    expect(
      unexemptedAdvisories([...all, ignored, overridden], {
        overrides: { ...overrides, "extract-zip": ">=2.0.2" },
        ignoreGhsas: [...ignoreGhsas, ignored.ghsa],
      }),
    ).toEqual([]);
  });
});
