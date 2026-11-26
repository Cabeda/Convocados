/**
 * Delivery must happen under a token that is alive (#937).
 *
 * The agent step may run 110 minutes; an App token lives 60. #937 and #1452
 * finished, passed Gate 1, then died on `git push` with `Bad credentials` —
 * while `continue-on-error` reported success. So the work job holds no push
 * scope, and a separate job mints a fresh token afterwards.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  deliveryPlan,
  isDeliverableBranch,
  parseStatus,
  readHandoff,
  titleFor,
} from "../../scripts/factory/deliver";
interface Job {
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, unknown> | string;
  steps?: Array<{
    name?: string;
    uses?: string;
    with?: Record<string, unknown>;
    env?: Record<string, unknown>;
  }>;
}

function jobs(): Record<string, Job> {
  const raw = readFileSync(path.join(process.cwd(), ".github/workflows/factory-issue.yml"), "utf8");
  return (parse(raw) as { jobs?: Record<string, Job> }).jobs ?? {};
}

const usesOf = (job: Job) =>
  (job.steps ?? []).map((s) => s.uses).filter((u): u is string => typeof u === "string");

describe("the branch a handoff names", () => {
  it("accepts factory/<issue>-<slug>", () => {
    expect(isDeliverableBranch("factory/937-anonymous-device-notifications")).toBe(true);
  });

  it.each(["main", "feature/x", "factory/", "factory/abc-x", "factory/937-", null, undefined])(
    "refuses %s",
    (branch) => {
      expect(isDeliverableBranch(branch as string | null | undefined)).toBe(false);
    },
  );
});

describe("the handoff a run leaves behind", () => {
  it("delivers only an explicit review", () => {
    expect(parseStatus("review\n")).toBe("review");
    expect(parseStatus("blocked")).toBe("blocked");
    expect(parseStatus(null)).toBe("blocked");
  });

  it("reads status, branch and title, and still names a Change without a title", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "factory-handoff-"));
    writeFileSync(path.join(dir, "status"), "review\n");
    writeFileSync(path.join(dir, "branch"), "factory/937-anonymous-device-notifications\n");
    writeFileSync(path.join(dir, "title"), "feat: anonymous device notifications\n");

    expect(readHandoff(dir)).toEqual({
      status: "review",
      branch: "factory/937-anonymous-device-notifications",
      title: "feat: anonymous device notifications",
    });
    expect(titleFor("", 937)).toBe("factory: work Issue #937");
  });
});

describe("the work job cannot outlive its credential", () => {
  it("holds no App token and no contents:write", () => {
    const factory = jobs().factory;
    expect(factory, "factory-issue.yml must have a factory job").toBeDefined();
    expect(usesOf(factory)).not.toContain("actions/create-github-app-token@v3");
    expect(JSON.stringify(factory.permissions ?? {})).not.toContain('"contents":"write"');
  });

  it("runs as the job's own read/claim token", () => {
    const agent = jobs().factory.steps?.find((s) => s.uses?.startsWith("anomalyco/opencode"));
    expect(JSON.stringify(agent?.env ?? {})).toContain("github.token");
  });

  it("uploads the hidden handoff directory", () => {
    // upload-artifact skips hidden paths unless asked: run 39447497995 logged
    // "No files were found with the provided path: .factory-handoff/" and
    // delivered an empty Blocked even though the work was committed.
    const upload = jobs().factory.steps?.find((s) => s.uses === "actions/upload-artifact@v7");
    expect(upload?.with?.["include-hidden-files"]).toBe(true);
  });
});

describe("delivery runs after the work, with a fresh token", () => {
  it("depends on the work job, runs even when it fails, and mints its own token", () => {
    const deliver = jobs().deliver;
    expect(deliver, "factory-issue.yml must have a deliver job").toBeDefined();
    expect(deliver.needs).toBe("factory");
    expect(deliver.if).toContain("always()");
    expect(usesOf(deliver)).toContain("actions/create-github-app-token@v3");
  });
});

describe("a handoff pushes without opening a Change", () => {
  // A Blocked run used to leave its commits in an artifact nothing reads: the
  // "a killed run keeps its work" claim was false, and the next run started
  // from an empty branch and paid for the same reproduction again.
  it("pushes and opens a Change only for an explicit review", () => {
    expect(deliveryPlan("review", "factory/1-thing", true)).toEqual({ push: true, openChange: true });
  });

  it("pushes a Blocked run's branch, and opens nothing", () => {
    expect(deliveryPlan("blocked", "factory/1-thing", true)).toEqual({
      push: true,
      openChange: false,
    });
  });

  it("pushes nothing without a deliverable branch or a bundle", () => {
    expect(deliveryPlan("review", "main", true)).toEqual({ push: false, openChange: false });
    expect(deliveryPlan("review", "factory/1-thing", false)).toEqual({
      push: false,
      openChange: false,
    });
  });
});

describe("the fixer keeps its branch and its token apart", () => {
  const workflow = (file: string) =>
    (parse(
      readFileSync(path.join(process.cwd(), ".github/workflows", file), "utf8"),
    ) as { jobs?: Record<string, Job> }).jobs ?? {};

  it("creates the branch before the agent, so a killed run keeps its work", () => {
    const names = (workflow("factory-fix.yml").fix?.steps ?? []).map((s) => s.name ?? "");
    const branch = names.indexOf("Start the Change branch");
    const agent = names.indexOf("Run the Fixer");
    expect(branch, "factory-fix.yml must pre-create the branch").toBeGreaterThanOrEqual(0);
    expect(branch, "the branch must exist before the agent runs").toBeLessThan(agent);
  });

  it("gives the round a read-only token", () => {
    const round = workflow("factory-fix-loop.yml").round;
    const mint = round?.steps?.find((s) => s.uses === "actions/create-github-app-token@v3");
    expect(mint?.with?.["permission-contents"]).toBe("read");
    expect(round?.permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
      issues: "read",
    });
  });

  it("never lets the write token into the job that runs the agent", () => {
    // The round's job mints no write scope at all; the push job mints it and
    // runs no agent. A push step sharing the agent's workspace would execute a
    // `pre-push` hook the agent wrote, with the token already in its environ.
    const jobs = workflow("factory-fix-loop.yml");
    expect(usesOf(jobs.push ?? {})).not.toContain("anomalyco/opencode/github@latest");
    expect(JSON.stringify(jobs.push?.permissions ?? {})).toBe("{}");
    expect(JSON.stringify(jobs.round?.permissions ?? {})).not.toContain('"contents":"write"');
  });
});
