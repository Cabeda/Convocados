import { describe, it, expect } from "vitest";
import {
  parseRecurrenceRule,
  serializeRecurrenceRule,
  nextOccurrence,
  describeRecurrenceRule,
  type RecurrenceRule,
} from "~/lib/recurrence";

describe("parseRecurrenceRule", () => {
  it("returns null for null input", () => {
    expect(parseRecurrenceRule(null)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseRecurrenceRule("not-json")).toBeNull();
  });

  it("parses a valid weekly rule", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1 };
    expect(parseRecurrenceRule(JSON.stringify(rule))).toEqual(rule);
  });

  it("parses a rule with byDay", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 2, byDay: "TU" };
    expect(parseRecurrenceRule(JSON.stringify(rule))).toEqual(rule);
  });

  it("parses a monthly rule", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 3 };
    expect(parseRecurrenceRule(JSON.stringify(rule))).toEqual(rule);
  });
});

describe("serializeRecurrenceRule", () => {
  it("round-trips a rule", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "MO" };
    expect(parseRecurrenceRule(serializeRecurrenceRule(rule))).toEqual(rule);
  });
});

describe("nextOccurrence", () => {
  const base = new Date("2026-03-10T18:00:00Z"); // Tuesday

  it("advances weekly by interval weeks", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1 };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString()).toBe("2026-03-17T18:00:00.000Z");
  });

  it("advances weekly by 2 weeks", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 2 };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString()).toBe("2026-03-24T18:00:00.000Z");
  });

  it("advances monthly by interval months", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1 };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    // Use date-only assertion — setMonth() operates in local time and DST can shift the UTC hour
    expect(next.toISOString().slice(0, 10)).toBe("2026-04-10");
  });

  it("advances monthly by 2 months", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 2 };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString().slice(0, 10)).toBe("2026-05-10");
  });

  it("adjusts to byDay before advancing", () => {
    // base is Tuesday (2), byDay MO (1) → shifts to Monday 2026-03-09, then advances
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "MO" };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    // Monday 2026-03-09 + 7 days = 2026-03-16
    expect(next.getDay()).toBe(1); // Monday
  });

  it("keeps advancing until result is after 'after'", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1 };
    const after = new Date("2026-04-01T00:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });
});

describe("describeRecurrenceRule", () => {
  it("describes every week in English", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 1 }, "en")).toBe("Every week");
  });

  it("describes every N weeks in English", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 3 }, "en")).toBe("Every 3 weeks");
  });

  it("describes every week on a day in English", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 1, byDay: "TU" }, "en")).toBe("Every week on Tuesday");
  });

  it("describes every N weeks on a day in English", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 2, byDay: "FR" }, "en")).toBe("Every 2 weeks on Friday");
  });

  it("describes every month in English", () => {
    expect(describeRecurrenceRule({ freq: "monthly", interval: 1 }, "en")).toBe("Every month");
  });

  it("describes every N months in English", () => {
    expect(describeRecurrenceRule({ freq: "monthly", interval: 2 }, "en")).toBe("Every 2 months");
  });

  it("describes every week in Portuguese", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 1 }, "pt")).toBe("Todas as semanas");
  });

  it("describes every N weeks in Portuguese", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 2 }, "pt")).toBe("De 2 em 2 semanas");
  });

  it("describes every month in Portuguese", () => {
    expect(describeRecurrenceRule({ freq: "monthly", interval: 1 }, "pt")).toBe("Todos os meses");
  });

  it("defaults to English when no locale given", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 1 })).toBe("Every week");
  });
});
