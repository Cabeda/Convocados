import { describe, it, expect } from "vitest";
import {
  validatePaymentMethod,
  validatePaymentMethods,
  normalizePaymentMethod,
  parsePaymentMethods,
  getPayerLabel,
} from "../lib/paymentMethods";

describe("validatePaymentMethod with payer fields", () => {
  it("accepts a method without payer fields (backwards compat)", () => {
    expect(validatePaymentMethod({ type: "mbway", value: "912345678" })).toBeNull();
  });

  it("accepts a method with payerUserId and payerName", () => {
    expect(
      validatePaymentMethod({
        type: "mbway",
        value: "912345678",
        payerUserId: "u-jose",
        payerName: "José",
      }),
    ).toBeNull();
  });

  it("rejects payerName without payerUserId (must be a pair)", () => {
    const err = validatePaymentMethod({
      type: "mbway",
      value: "912345678",
      payerName: "José",
    });
    expect(err).toMatch(/payer/i);
  });

  it("rejects payerUserId of wrong type", () => {
    const err = validatePaymentMethod({
      type: "mbway",
      value: "912345678",
      payerUserId: 12345,
      payerName: "José",
    });
    expect(err).toMatch(/payer/i);
  });

  it("rejects empty payerName when payerUserId is set", () => {
    const err = validatePaymentMethod({
      type: "mbway",
      value: "912345678",
      payerUserId: "u-jose",
      payerName: "   ",
    });
    expect(err).toMatch(/payer/i);
  });
});

describe("validatePaymentMethods with payer fields", () => {
  it("accepts a mixed array (some with payer, some without)", () => {
    const err = validatePaymentMethods([
      { type: "mbway", value: "912345678", payerUserId: "u-jose", payerName: "José" },
      { type: "cash", value: "On arrival" },
    ]);
    expect(err).toBeNull();
  });
});

describe("normalizePaymentMethod preserves payer", () => {
  it("preserves payerUserId and trims payerName", () => {
    const out = normalizePaymentMethod({
      type: "mbway",
      value: "912 345 678",
      payerUserId: "u-jose",
      payerName: "  José  ",
    });
    expect(out.payerUserId).toBe("u-jose");
    expect(out.payerName).toBe("José");
    expect(out.value).toBe("912345678"); // phones get whitespace stripped
  });

  it("passes through null payer (backwards compat)", () => {
    const out = normalizePaymentMethod({ type: "cash", value: "On arrival" });
    expect(out.payerUserId ?? null).toBeNull();
    expect(out.payerName ?? null).toBeNull();
  });
});

describe("parsePaymentMethods with payer fields", () => {
  it("parses methods with and without payer from JSON", () => {
    const json = JSON.stringify([
      { type: "mbway", value: "912345678", payerUserId: "u-jose", payerName: "José" },
      { type: "cash", value: "On arrival" },
    ]);
    const parsed = parsePaymentMethods(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].payerName).toBe("José");
    expect(parsed[1].payerUserId ?? null).toBeNull();
  });

  it("ignores methods with invalid payer (drops them)", () => {
    const json = JSON.stringify([
      { type: "mbway", value: "912345678", payerName: "José" }, // no payerUserId
    ]);
    expect(parsePaymentMethods(json)).toEqual([]);
  });
});

describe("getPayerLabel", () => {
  it("returns 'Each player pays directly' when no payer is set", () => {
    expect(getPayerLabel({ type: "mbway", value: "912345678" }, "tDirect"))
      .toBe("tDirect");
  });

  it("returns 'Pay {name}' when a payer is set", () => {
    expect(getPayerLabel({ type: "mbway", value: "912345678", payerUserId: "u-jose", payerName: "José" }, "tDirect"))
      .toMatch(/José/);
  });
});
