import { describe, it, expect } from "vitest";
import {
  evaluate,
  hasClosingKeyword,
  isExempt,
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
