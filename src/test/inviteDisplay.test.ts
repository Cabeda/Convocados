import { describe, it, expect } from "vitest";
import { RESEND_COOLDOWN_MS, earliestResendAt, formatCooldown, resendEligibility, sentChannels } from "~/lib/inviteDisplay";

const NOW = Date.parse("2026-03-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("resendEligibility", () => {
  it("may resend an invite that was never delivered", () => {
    expect(resendEligibility(null, NOW)).toEqual({ eligible: true, remainingMs: 0 });
    expect(resendEligibility(undefined, NOW).eligible).toBe(true);
  });
  it("waits out the 24 hour cooldown and says how long is left", () => {
    expect(resendEligibility(ago(2 * 3_600_000), NOW)).toEqual({ eligible: false, remainingMs: RESEND_COOLDOWN_MS - 2 * 3_600_000 });
    expect(resendEligibility(ago(RESEND_COOLDOWN_MS), NOW).eligible).toBe(true);
    expect(resendEligibility(ago(RESEND_COOLDOWN_MS + 1), NOW).remainingMs).toBe(0);
  });
});

describe("formatCooldown", () => {
  it("reads hours and minutes, minutes alone, or whole hours", () => {
    expect(formatCooldown(23 * 3_600_000 + 5 * 60_000)).toBe("23h 5m");
    expect(formatCooldown(42 * 60_000)).toBe("42m");
    expect(formatCooldown(2 * 3_600_000)).toBe("2h");
  });
  it("rounds a part-minute up so it never says 0m while waiting", () => expect(formatCooldown(1_000)).toBe("1m"));
});

describe("sentChannels", () => {
  it("lists the channels in a fixed order, and none for a link-only invite", () => {
    expect(sentChannels({ email: true, webPush: false, appPush: true }).map((c) => c.key)).toEqual(["email", "app"]);
    expect(sentChannels({ email: false, webPush: false, appPush: false })).toEqual([]);
    expect(sentChannels(undefined)).toEqual([]);
  });
});

describe("earliestResendAt", () => {
  it("is the first moment any cooling invite can be sent again", () => {
    const at = earliestResendAt([ago(2 * 3_600_000), ago(10 * 3_600_000), null], NOW);
    expect(at).toBe(NOW - 10 * 3_600_000 + RESEND_COOLDOWN_MS);
  });
  it("is null when nothing is cooling down", () => {
    expect(earliestResendAt([null, ago(RESEND_COOLDOWN_MS + 5)], NOW)).toBeNull();
    expect(earliestResendAt([], NOW)).toBeNull();
  });
});
