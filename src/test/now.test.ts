import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { now, nowMs } from "../lib/now";

const ENV_KEY = "CONVOCADOS_FIXED_NOW";
const original = process.env[ENV_KEY];

describe("now clock seam", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it("returns wall-clock time when no override is set", () => {
    const before = Date.now();
    const value = nowMs();
    const after = Date.now();

    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });

  it("returns the frozen instant when CONVOCADOS_FIXED_NOW is set", () => {
    process.env[ENV_KEY] = "2026-03-14T18:00:00.000Z";

    expect(nowMs()).toBe(Date.parse("2026-03-14T18:00:00.000Z"));
  });

  it("now() mirrors nowMs()", () => {
    process.env[ENV_KEY] = "2026-03-14T18:00:00.000Z";

    expect(now()).toEqual(new Date(Date.parse("2026-03-14T18:00:00.000Z")));
  });

  it("falls back to wall clock when the override is unparseable", () => {
    process.env[ENV_KEY] = "not-a-date";

    const before = Date.now();
    const value = nowMs();
    const after = Date.now();

    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });
});
