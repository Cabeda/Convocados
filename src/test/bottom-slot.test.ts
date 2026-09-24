import { describe, it, expect } from "vitest";
import { pickBottomBanner } from "~/lib/bottomSlot";

describe("pickBottomBanner (pure priority)", () => {
  it("prefers update over install and push", () => {
    expect(pickBottomBanner({ update: true, install: true, push: true })).toBe("update");
  });

  it("prefers install over push when no update is pending", () => {
    expect(pickBottomBanner({ install: true, push: true })).toBe("install");
  });

  it("returns push when it is the only active claimant", () => {
    expect(pickBottomBanner({ push: true })).toBe("push");
  });

  it("ignores falsy claims and returns null when nothing wants the slot", () => {
    expect(pickBottomBanner({ update: false, install: false, push: false })).toBeNull();
    expect(pickBottomBanner({})).toBeNull();
  });

  it("ignores unknown keys", () => {
    expect(pickBottomBanner({ install: true } as never)).toBe("install");
  });
});
