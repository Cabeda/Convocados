/**
 * The `CI` gate is the one required status check, so its verdict is what stands
 * between a Change and `main`. It lives in `scripts/ci-gate.sh` (not inline in
 * the workflow) so it can be tested: a gate that only runs on the runner is a
 * gate nobody can exercise before pushing.
 *
 * The case this file exists for: a superseded run. A push cancels the previous
 * run's jobs, so the cancelled run reports a red `CI` — and a red that does not
 * say *why* sends whoever reads it hunting through twenty green rows for a
 * blocker that is not there.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();

/** One `needs` entry, shaped the way the workflow's `toJSON(needs)` gives it. */
function job(result: string): { result: string; outputs: Record<string, unknown> } {
  return { result, outputs: {} };
}

function runGate(needs: Record<string, { result: string }>, onMain = false): { status: number; output: string } {
  try {
    const output = execFileSync("sh", ["scripts/ci-gate.sh"], {
      cwd: root,
      input: JSON.stringify(needs),
      env: { ...process.env, CI_GATE_ON_MAIN: onMain ? "true" : "false" },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("the CI gate", () => {
  it("passes when every required job passed", () => {
    const { status, output } = runGate({ typecheck: job("success"), lint: job("success") });
    expect(status).toBe(0);
    expect(output).toContain("All required jobs passed");
  });

  it("names the job that failed", () => {
    const { status, output } = runGate({ typecheck: job("success"), e2e: job("failure") });
    expect(status).toBe(1);
    expect(output).toContain("Required job(s) failed");
    expect(output).toContain("e2e");
    expect(output).not.toContain("typecheck");
  });

  it("says a cancelled run was superseded, not that a job went red", () => {
    // A push cancels the previous run's jobs, so this is the shape of a
    // superseded run — the red belongs to a commit that is no longer the head.
    const { status, output } = runGate({ typecheck: job("cancelled"), lint: job("cancelled") });
    expect(status).toBe(1);
    expect(output).toContain("were cancelled");
    expect(output).toContain("typecheck");
    expect(output).toMatch(/superseded/i);
    expect(output).toMatch(/head SHA/i);
  });

  it("fails a skipped Android build on main", () => {
    const { status, output } = runGate({ android: job("skipped"), "android-wear": job("success") }, true);
    expect(status).toBe(1);
    expect(output).toContain("skipped on main");
  });

  it("allows a skipped Android build off main", () => {
    const { status } = runGate({ android: job("skipped"), "android-wear": job("skipped") });
    expect(status).toBe(0);
  });
});
