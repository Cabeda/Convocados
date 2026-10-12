/**
 * The release job must survive being re-run.
 *
 * This exists because v3.236.1 needed two attempts plus a manual `flyctl
 * deploy`. Neither failure was in the shipped code:
 *
 *  1. `Deploy to Fly.io` waited 60s for the release_command machine to
 *     start/run/stop. That cycle measured 61s, so the deploy aborted after the
 *     release command had already succeeded.
 *  2. The second attempt died at `git tag` — a `workflow_run` rerun checks out
 *     the same pre-bump SHA, recomputes the same version, and collides with the
 *     tag its own previous attempt pushed.
 *
 * `workflows.test.ts` pins YAML shape and action refs, so none of that was
 * visible to it (the review said exactly this). These assertions are about step
 * LOGIC: a future edit that drops a guard, shortens the wait, or goes back to a
 * bare `createRelease` fails here instead of on the next production merge.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const releaseYml = readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Job {
  steps?: Step[];
}
interface Workflow {
  jobs?: Record<string, Job>;
}

const doc = parse(releaseYml) as Workflow;

/** The step's shell text: `run:` or the `script:` input of a `uses:` action. */
function stepText(job: string, name: string): string {
  const steps = doc.jobs?.[job]?.steps ?? [];
  const step = steps.find((s) => s.name === name);
  if (!step) throw new Error(`${job} has no step named "${name}"`);
  return step.run ?? String(step.with?.script ?? "");
}

describe("release workflow survives a rerun", () => {
  it("waits longer than the measured release_command cycle", () => {
    const deploy = stepText("deploy", "Deploy to Fly.io");
    const wait = deploy.match(/--wait-timeout\s+(\d+)s/);
    expect(wait, "Deploy to Fly.io must pass --wait-timeout").not.toBeNull();
    // The release machine took 61s on v3.236.1; 60s aborted a deploy whose
    // release command had already succeeded.
    expect(Number(wait![1])).toBeGreaterThanOrEqual(300);
  });

  it("reuses an existing tag instead of failing on it", () => {
    const tag = stepText("release", "Create tag");
    expect(tag, "Create tag must check whether the tag exists").toMatch(/rev-parse[^\n]*refs\/tags\//);
    expect(tag, "tags must only be created when absent").toMatch(/if\b[\s\S]*?git tag/);
  });

  it("does not push an ancestor of main when there is nothing to bump", () => {
    const bump = stepText("release", "Commit version bump");
    expect(bump, "the bump must be skipped when package.json already matches").toContain("git diff --cached --quiet");
    // The push has to be inside the guarded branch: pushing a commit that is an
    // ancestor of main is a non-fast-forward rejection.
    const pushIndex = bump.indexOf("git push origin HEAD:main");
    const guardIndex = bump.indexOf("git diff --cached --quiet");
    expect(pushIndex).toBeGreaterThan(guardIndex);
  });

  it("updates an existing GitHub release rather than 422ing on it", () => {
    const release = stepText("release", "Create GitHub Release");
    expect(release, "must look the release up first").toContain("getReleaseByTag");
    expect(release, "must update when it already exists").toContain("updateRelease");
    expect(release, "must still create when it does not").toContain("createRelease");
  });

  it("only treats a missing release as absent, not any error", () => {
    const release = stepText("release", "Create GitHub Release");
    // A blanket `.catch(() => null)` turns a transient API failure into a 422
    // from createRelease; only a 404 means "no release yet".
    expect(release).not.toMatch(/\.catch\(\s*\(\s*\)\s*=>\s*null\s*\)/);
    expect(release).toMatch(/status\s*===?\s*404/);
  });
});
