import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const script = resolve(projectRoot, "scripts/coverage-report.sh");

/** Run the script against a fixture coverage directory; returns stdout. */
function run(fixture: { summary: unknown; lcov?: string }): { out: string; status: number } {
  const dir = mkdtempSync(join(tmpdir(), "cov-report-"));
  writeFileSync(join(dir, "coverage-summary.json"), JSON.stringify(fixture.summary));
  if (fixture.lcov !== undefined) writeFileSync(join(dir, "lcov.info"), fixture.lcov);

  try {
    const out = execFileSync("sh", [script, "94"], {
      cwd: projectRoot,
      env: { ...process.env, COVERAGE_DIR: dir },
      encoding: "utf8",
    });
    return { out, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { out: err.stdout ?? "", status: err.status ?? 1 };
  }
}

const summaryWith = (name: string, pct: number) => ({
  total: { lines: { pct } },
  [name]: { lines: { pct } },
});

describe("scripts/coverage-report.sh", () => {
  it("lists the uncovered line ranges of the worst file from lcov.info", () => {
    const { out, status } = run({
      summary: summaryWith("/repo/src/weak.ts", 80),
      lcov: [
        "SF:/repo/src/weak.ts",
        "DA:3,0",
        "DA:4,0",
        "DA:5,7",
        "DA:9,0",
        "end_of_record",
      ].join("\n"),
    });

    expect(out).toContain("80.0%  /repo/src/weak.ts");
    expect(out).toMatch(/Uncovered line ranges in \/repo\/src\/weak\.ts: 3-4, 9/);
    // A file below the threshold is a non-zero exit: the gate reads it.
    expect(status).toBe(1);
  });

  it("does not crash when lcov.info is missing", () => {
    const { out, status } = run({ summary: summaryWith("/repo/src/weak.ts", 80) });

    expect(out).toContain("/repo/src/weak.ts");
    expect(out).toContain("lcov.info not found");
    expect(status).toBe(1);
  });

  it("exits 0 when every file is at or above the threshold", () => {
    const { out, status } = run({
      summary: summaryWith("/repo/src/strong.ts", 99),
      lcov: "",
    });

    expect(out).toContain("none — all files at or above threshold.");
    expect(status).toBe(0);
  });
});
