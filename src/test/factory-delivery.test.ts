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
import { isDeliverableBranch, parseStatus, readHandoff, titleFor } from "../../scripts/factory/deliver";

interface Job {
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, unknown> | string;
  steps?: Array<{ uses?: string; with?: Record<string, unknown>; env?: Record<string, unknown> }>;
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
