import { describe, it, expect } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluate,
  hasClosingKeyword,
  isExempt,
  resolveInput,
} from "../../scripts/check-pr-closing-keyword.mjs";

/**
 * The `PR Links Issue` job runs this module; pinning the behaviour here is the
 * point — a regex typo in an inline workflow snippet ships green, which is the
 * defect this extraction fixes.
 */
describe("PR closing-keyword check", () => {
  it.each([
    ["Closes #123"],
    ["closes #123"],
    ["This PR closes #123."],
    ["Fixes #45"],
    ["fixed #45"],
    ["Resolves #7"],
    ["resolved: #7"],
    ["Multiple things\n\nCloses #1\nFixes #2"],
    ["See the plan.\n\nClose #999"],
  ])("accepts %j", (body) => {
    expect(hasClosingKeyword(body)).toBe(true);
    expect(evaluate({ body, labels: [] })).toEqual({ ok: true, reason: "keyword" });
  });

  it.each([
    [""],
    [null],
    ["Just a summary, no issue link."],
    ["Refs #123"], // Refs does NOT close — deliberate
    ["Related to the #123 investigation"],
    ["closes the PR without a number"],
    ["closes #abc"], // not a numeric issue reference
  ])("rejects %j", (body) => {
    expect(hasClosingKeyword(body)).toBe(false);
    expect(evaluate({ body, labels: [] })).toEqual({ ok: false, reason: "missing" });
  });

  it("exempts a PR carrying the no-issue label, regardless of body", () => {
    expect(isExempt(["no-issue"])).toBe(true);
    expect(evaluate({ body: "no link here", labels: ["enhancement", "no-issue"] })).toEqual({
      ok: true,
      reason: "exempt",
    });
  });

  it("does not treat a similarly-named label as the escape hatch", () => {
    expect(isExempt(["no-issues", "noissue"])).toBe(false);
  });

  it("prefers the keyword when both a keyword and the label are present", () => {
    expect(evaluate({ body: "Closes #1", labels: ["no-issue"] }).reason).toBe("exempt");
  });
});

/**
 * Dependabot cannot apply the `no-issue` label, so every dependency bump would
 * otherwise need a human before the required `PR Links Issue` check can pass.
 * The exemption is scoped to the dependency bot's exact login; the factory's
 * own bot and human PRs still fail closed.
 */
describe("PR closing-keyword check — dependency bots", () => {
  it("exempts a Dependabot Change with an empty body and no label", () => {
    expect(evaluate({ body: "", labels: ["dependencies"], author: "dependabot[bot]" })).toEqual({
      ok: true,
      reason: "bot",
    });
  });

  it("does not exempt a machine-authored Change that is not the dependency bot", () => {
    expect(evaluate({ body: "", labels: [], author: "convocados-factory-bot" })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("does not exempt a human PR with an empty body and no label", () => {
    expect(evaluate({ body: "", labels: [], author: "Cabeda" })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("reads the PR author from the workflow event, so Dependabot needs no human label", () => {
    const event = join(tmpdir(), `pr-event-${process.pid}.json`);
    writeFileSync(
      event,
      JSON.stringify({ pull_request: { user: { login: "dependabot[bot]" } } }),
      "utf8",
    );
    try {
      const input = resolveInput({
        argv: [],
        env: { PR_BODY: "", PR_LABELS: "dependencies", GITHUB_EVENT_PATH: event },
      });
      expect(evaluate(input)).toEqual({ ok: true, reason: "bot" });
    } finally {
      rmSync(event, { force: true });
    }
  });

  it("still fails a human PR in the workflow event with no keyword and no label", () => {
    const event = join(tmpdir(), `pr-event-human-${process.pid}.json`);
    writeFileSync(
      event,
      JSON.stringify({ pull_request: { user: { login: "Cabeda" } } }),
      "utf8",
    );
    try {
      const input = resolveInput({
        argv: [],
        env: { PR_BODY: "", PR_LABELS: "dependencies", GITHUB_EVENT_PATH: event },
      });
      expect(evaluate(input)).toEqual({ ok: false, reason: "missing" });
    } finally {
      rmSync(event, { force: true });
    }
  });

  it("fails closed when neither PR_AUTHOR nor an event file names the author", () => {
    expect(
      evaluate(resolveInput({ argv: [], env: { PR_BODY: "", PR_LABELS: "dependencies" } })),
    ).toEqual({ ok: false, reason: "missing" });
  });
});

/**
 * The CI job feeds the check the PR body from the environment. That is the
 * wrong side of the action boundary for the agent, which holds the body in a
 * file and has already run `gh pr create` by the time CI sees it — the failure
 * always costs a second trip. `resolveInput` is the same decision reached from
 * the command line, so the body can be checked *before* the PR exists.
 */
describe("PR closing-keyword check — command line", () => {
  const body = "## Summary\n\nDoes a thing.\n\nCloses #42\n";

  it("reads the body from a file when one is passed", () => {
    const file = join(tmpdir(), `pr-body-${process.pid}.md`);
    writeFileSync(file, body, "utf8");
    try {
      expect(resolveInput({ argv: [file], env: {} })).toEqual({ body, labels: [] });
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("ignores flags when looking for the body file", () => {
    const file = join(tmpdir(), `pr-body-flags-${process.pid}.md`);
    writeFileSync(file, body, "utf8");
    try {
      expect(resolveInput({ argv: ["--no-issue", file], env: {} }).body).toBe(body);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("falls back to PR_BODY when no file is passed", () => {
    expect(resolveInput({ argv: [], env: { PR_BODY: body } }).body).toBe(body);
  });

  it("treats --no-issue as the exemption, without needing the label", () => {
    expect(resolveInput({ argv: ["--no-issue"], env: {} }).labels).toContain("no-issue");
    expect(evaluate(resolveInput({ argv: ["--no-issue"], env: {} }))).toEqual({
      ok: true,
      reason: "exempt",
    });
  });

  it("keeps labels already in PR_LABELS alongside the flag", () => {
    expect(resolveInput({ argv: ["--no-issue"], env: { PR_LABELS: "enhancement" } }).labels).toEqual([
      "enhancement",
      "no-issue",
    ]);
  });

  it("reaches the same verdict as the CI job on the same body", () => {
    const file = join(tmpdir(), `pr-body-both-${process.pid}.md`);
    writeFileSync(file, "Just a summary.", "utf8");
    try {
      const cli = resolveInput({ argv: [file], env: {} });
      const ci = resolveInput({ argv: [], env: { PR_BODY: "Just a summary." } });
      expect(evaluate(cli)).toEqual(evaluate(ci));
    } finally {
      rmSync(file, { force: true });
    }
  });
});
