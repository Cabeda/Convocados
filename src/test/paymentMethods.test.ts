import { describe, it, expect } from "vitest";
import {
  validatePaymentMethod,
  validatePaymentMethods,
  normalizePaymentMethod,
  parsePaymentMethods,
  getDeepLink,
  getMbwayAppLink,
  getDisplayValue,
  type PaymentMethod,
} from "~/lib/paymentMethods";

describe("validatePaymentMethod", () => {
  it("rejects non-object input", () => {
    expect(validatePaymentMethod(null)).toBeTruthy();
    expect(validatePaymentMethod("string")).toBeTruthy();
    expect(validatePaymentMethod(42)).toBeTruthy();
  });

  it("rejects unknown type", () => {
    expect(validatePaymentMethod({ type: "bitcoin", value: "abc" })).toMatch(/Invalid type/);
  });

  it("rejects empty value", () => {
    expect(validatePaymentMethod({ type: "phone", value: "" })).toMatch(/required/);
    expect(validatePaymentMethod({ type: "phone", value: "   " })).toMatch(/required/);
  });

  it("validates phone numbers", () => {
    expect(validatePaymentMethod({ type: "phone", value: "+351912345678" })).toBeNull();
    expect(validatePaymentMethod({ type: "phone", value: "912 345 678" })).toBeNull();
    expect(validatePaymentMethod({ type: "phone", value: "123" })).toMatch(/6-15 digits/);
    expect(validatePaymentMethod({ type: "phone", value: "1234567890123456" })).toMatch(/6-15 digits/);
  });

  it("validates mbway numbers", () => {
    expect(validatePaymentMethod({ type: "mbway", value: "912345678" })).toBeNull();
    expect(validatePaymentMethod({ type: "mbway", value: "+351 912 345 678" })).toBeNull();
    expect(validatePaymentMethod({ type: "mbway", value: "12" })).toMatch(/6-15 digits/);
  });

  it("validates revolut tags", () => {
    expect(validatePaymentMethod({ type: "revolut_tag", value: "jose" })).toBeNull();
    expect(validatePaymentMethod({ type: "revolut_tag", value: "@jose" })).toBeNull();
    expect(validatePaymentMethod({ type: "revolut_tag", value: "jose.cabeda" })).toBeNull();
    expect(validatePaymentMethod({ type: "revolut_tag", value: "" })).toMatch(/required/);
    expect(validatePaymentMethod({ type: "revolut_tag", value: "a b c" })).toMatch(/Invalid Revolut tag/);
  });

  it("validates revolut links", () => {
    expect(validatePaymentMethod({ type: "revolut_link", value: "https://revolut.me/jose" })).toBeNull();
    expect(validatePaymentMethod({ type: "revolut_link", value: "https://rev.money/abc123" })).toBeNull();
    expect(validatePaymentMethod({ type: "revolut_link", value: "http://revolut.me/jose" })).toBeNull();
    expect(validatePaymentMethod({ type: "revolut_link", value: "https://example.com/pay" })).toMatch(/revolut\.me/);
    expect(validatePaymentMethod({ type: "revolut_link", value: "not-a-url" })).toMatch(/revolut\.me/);
  });
});

describe("validatePaymentMethods", () => {
  it("rejects non-array", () => {
    expect(validatePaymentMethods("not array")).toMatch(/must be an array/);
  });

  it("rejects more than 10 methods", () => {
    const methods = Array.from({ length: 11 }, () => ({ type: "phone", value: "912345678" }));
    expect(validatePaymentMethods(methods)).toMatch(/Maximum 10/);
  });

  it("accepts valid array", () => {
    expect(validatePaymentMethods([
      { type: "mbway", value: "912345678" },
      { type: "revolut_tag", value: "jose" },
    ])).toBeNull();
  });

  it("returns first error in array", () => {
    expect(validatePaymentMethods([
      { type: "mbway", value: "912345678" },
      { type: "phone", value: "12" },
    ])).toMatch(/6-15 digits/);
  });
});

describe("normalizePaymentMethod", () => {
  it("strips @ from revolut tags", () => {
    const m = normalizePaymentMethod({ type: "revolut_tag", value: "@jose" });
    expect(m.value).toBe("jose");
  });

  it("removes spaces from phone numbers", () => {
    const m = normalizePaymentMethod({ type: "phone", value: "+351 912 345 678" });
    expect(m.value).toBe("+351912345678");
  });

  it("removes spaces from mbway numbers", () => {
    const m = normalizePaymentMethod({ type: "mbway", value: "912 345 678" });
    expect(m.value).toBe("912345678");
  });

  it("trims revolut links", () => {
    const m = normalizePaymentMethod({ type: "revolut_link", value: "  https://revolut.me/jose  " });
    expect(m.value).toBe("https://revolut.me/jose");
  });
});

describe("parsePaymentMethods", () => {
  it("returns empty array for null/undefined", () => {
    expect(parsePaymentMethods(null)).toEqual([]);
    expect(parsePaymentMethods(undefined)).toEqual([]);
  });

  it("parses valid JSON string", () => {
    const json = JSON.stringify([{ type: "mbway", value: "912345678" }]);
    const result = parsePaymentMethods(json);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("mbway");
  });

  it("filters out invalid entries", () => {
    const json = JSON.stringify([
      { type: "mbway", value: "912345678" },
      { type: "invalid", value: "x" },
      { type: "phone", value: "12" }, // too short
    ]);
    const result = parsePaymentMethods(json);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parsePaymentMethods("not json")).toEqual([]);
  });
});

describe("getDeepLink", () => {
  it("generates tel: link for phone", () => {
    expect(getDeepLink({ type: "phone", value: "+351912345678" })).toBe("tel:+351912345678");
  });

  it("returns null for mbway (no direct deep link)", () => {
    expect(getDeepLink({ type: "mbway", value: "912345678" })).toBeNull();
  });

  it("generates revolut.me link for revolut_tag", () => {
    expect(getDeepLink({ type: "revolut_tag", value: "jose" })).toBe("https://revolut.me/jose");
  });

  it("appends amount and currency to revolut_tag link", () => {
    const link = getDeepLink({ type: "revolut_tag", value: "jose" }, 20, "EUR");
    expect(link).toBe("https://revolut.me/jose?amount=20.00&currency=EUR");
  });

  it("does not append amount if zero or negative", () => {
    expect(getDeepLink({ type: "revolut_tag", value: "jose" }, 0)).toBe("https://revolut.me/jose");
    expect(getDeepLink({ type: "revolut_tag", value: "jose" }, -5)).toBe("https://revolut.me/jose");
  });

  it("returns the URL directly for revolut_link", () => {
    expect(getDeepLink({ type: "revolut_link", value: "https://revolut.me/jose" })).toBe("https://revolut.me/jose");
  });
});

describe("getDisplayValue", () => {
  it("prefixes @ for revolut_tag", () => {
    expect(getDisplayValue({ type: "revolut_tag", value: "jose" })).toBe("@jose");
  });

  it("shows path for revolut_link", () => {
    expect(getDisplayValue({ type: "revolut_link", value: "https://revolut.me/jose123" })).toBe("jose123");
  });

  it("returns value as-is for phone and mbway", () => {
    expect(getDisplayValue({ type: "phone", value: "+351912345678" })).toBe("+351912345678");
    expect(getDisplayValue({ type: "mbway", value: "912345678" })).toBe("912345678");
  });
});

describe("getMbwayAppLink", () => {
  it("returns Android intent URI that opens app with Play Store fallback", () => {
    const link = getMbwayAppLink("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36");
    expect(link).toBe(
      "intent://#Intent;package=pt.sibs.android.mbway;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dpt.sibs.android.mbway;end"
    );
  });

  it("returns mbway:// custom scheme for iOS to open app directly", () => {
    const link = getMbwayAppLink("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    expect(link).toBe("mbway://");
  });

  it("returns null for desktop user agent", () => {
    const link = getMbwayAppLink("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(link).toBeNull();
  });

  it("returns null for empty user agent", () => {
    expect(getMbwayAppLink("")).toBeNull();
    expect(getMbwayAppLink(undefined)).toBeNull();
  });
});
