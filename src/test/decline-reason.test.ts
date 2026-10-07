/**
 * The decline decision, pinned.
 *
 * The regression is #1216: labelled 2026-09-29T10:23:40Z, run fired 3s later,
 * skipped silently because the factory's identity did not exist yet. GitHub
 * never replayed it, so a live offer was lost for a week.
 */
import { describe, expect, it } from "vitest";
import {
  declineNotice,
  declineReason,
  shouldNotify,
  READY_LABEL,
  type DispatchFacts,
} from "../../scripts/factory/decline-reason";

const READY = { paused: false, appId: "5120869", model: "opencode/mimo" };

function facts(overrides: Partial<DispatchFacts> = {}): DispatchFacts {
  return { mode: "issues", labelName: READY_LABEL, ...READY, ...overrides };
}

describe("a well-formed offer proceeds", () => {
  it("runs when the label is right and the identity exists", () => {
    expect(declineReason(facts())).toBeNull();
  });

  it("proceeds on manual dispatch regardless of identity", () => {
    // workflow_dispatch carries the Issue number explicitly, so the agent
    // re-checks the label itself rather than relying on the event payload.
    expect(declineReason(facts({ mode: "workflow_dispatch", labelName: null, appId: "", model: "" }))).toBeNull();
  });
});

describe("ordinary triage stays silent", () => {
  it("declines a non-offer label", () => {
    expect(declineReason(facts({ labelName: "dex:pending" }))).toBe("not-an-offer");
  });

  it("never notifies for a non-offer", () => {
    // Commenting here would mean commenting on the whole backlog every time
    // somebody triages. This is the noise the Sweeper is warned about.
    expect(shouldNotify("not-an-offer")).toBe(false);
  });

  it("does not notify when it proceeds", () => {
    expect(shouldNotify(null)).toBe(false);
  });
});

describe("a live offer we cannot honour is always loud", () => {
  it("reports a paused factory", () => {
    expect(declineReason(facts({ paused: true }))).toBe("paused");
    expect(shouldNotify("paused")).toBe(true);
  });

  it("reports a missing App id", () => {
    expect(declineReason(facts({ appId: "" }))).toBe("no-app-id");
    expect(shouldNotify("no-app-id")).toBe(true);
  });

  it("treats whitespace as missing", () => {
    expect(declineReason(facts({ model: "   " }))).toBe("no-model");
  });

  it("prefers the most fundamental cause when several are wrong", () => {
    // Paused stops everything at every entry point, so it outranks identity:
    // fixing the identity would not un-pause the factory.
    expect(declineReason(facts({ paused: true, appId: "", model: "" }))).toBe("paused");
    // Identity before model: there is no point naming a model with no identity.
    expect(declineReason(facts({ appId: "", model: "" }))).toBe("no-app-id");
  });
});

describe("the notice tells the human what to do", () => {
  it("names the label and says nothing is queued", () => {
    const body = declineNotice("no-model", 1216);
    expect(body).toContain(READY_LABEL);
    expect(body).toMatch(/nothing is queued/);
  });

  it("gives a concrete remedy and the re-apply step", () => {
    const body = declineNotice("no-app-id", 1216);
    expect(body).toContain("FACTORY_APP_ID");
    expect(body).toMatch(/re-apply/);
    // GitHub does not replay, so the re-apply instruction is the actual fix.
    expect(body).toMatch(/does not replay past events/);
  });

  it("refuses to build a notice for the silent path", () => {
    // A guard, not decoration: a regression that starts announcing ordinary
    // triage would spam the backlog, and this makes that loud in tests.
    expect(() => declineNotice("not-an-offer", 1)).toThrow();
  });
});