import { describe, it, expect } from "vitest";
import {
  parseRecurrenceRule,
  serializeRecurrenceRule,
  nextOccurrence,
  describeRecurrenceRule,
  type RecurrenceRule,
} from "~/lib/recurrence";

// ---------------------------------------------------------------------------
// parseRecurrenceRule
// ---------------------------------------------------------------------------
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

  it("parses a daily rule", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1 };
    expect(parseRecurrenceRule(JSON.stringify(rule))).toEqual(rule);
  });

  it("parses a yearly rule", () => {
    const rule: RecurrenceRule = { freq: "yearly", interval: 2 };
    expect(parseRecurrenceRule(JSON.stringify(rule))).toEqual(rule);
  });

  it("parses a multi-day weekly rule", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "MO,WE,FR" };
    expect(parseRecurrenceRule(JSON.stringify(rule))).toEqual(rule);
  });

  it("returns null for empty string", () => {
    expect(parseRecurrenceRule("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serializeRecurrenceRule
// ---------------------------------------------------------------------------
describe("serializeRecurrenceRule", () => {
  it("round-trips a weekly rule with byDay", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "MO" };
    expect(parseRecurrenceRule(serializeRecurrenceRule(rule))).toEqual(rule);
  });

  it("round-trips a daily rule", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 3 };
    expect(parseRecurrenceRule(serializeRecurrenceRule(rule))).toEqual(rule);
  });

  it("round-trips a yearly rule", () => {
    const rule: RecurrenceRule = { freq: "yearly", interval: 1 };
    expect(parseRecurrenceRule(serializeRecurrenceRule(rule))).toEqual(rule);
  });

  it("round-trips a monthly rule", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 2 };
    expect(parseRecurrenceRule(serializeRecurrenceRule(rule))).toEqual(rule);
  });

  it("round-trips a multi-day weekly rule", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "TU,TH,SA" };
    expect(parseRecurrenceRule(serializeRecurrenceRule(rule))).toEqual(rule);
  });
});

// ---------------------------------------------------------------------------
// nextOccurrence — daily
// ---------------------------------------------------------------------------
describe("nextOccurrence — daily", () => {
  const base = new Date("2026-03-10T18:00:00Z"); // Tuesday

  it("advances daily by 1 day", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1 };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString()).toBe("2026-03-11T18:00:00.000Z");
  });

  it("advances daily by 3 days", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 3 };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString()).toBe("2026-03-13T18:00:00.000Z");
  });

  it("returns next day when after equals base exactly", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1 };
    const next = nextOccurrence(base, rule, base);
    expect(next.toISOString()).toBe("2026-03-11T18:00:00.000Z");
  });

  it("skips multiple intervals to get past after", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 2 };
    const after = new Date("2026-03-15T00:00:00Z");
    const next = nextOccurrence(base, rule, after);
    // base + 2 = Mar12, +2 = Mar14, +2 = Mar16 (first > Mar15)
    expect(next.toISOString()).toBe("2026-03-16T18:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// nextOccurrence — weekly
// ---------------------------------------------------------------------------
describe("nextOccurrence — weekly", () => {
  const base = new Date("2026-03-10T18:00:00Z"); // Tuesday

  it("advances weekly by 1 week (no byDay)", () => {
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

  it("adjusts to byDay MO before advancing", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "MO" };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.getDay()).toBe(1); // Monday
  });

  it("adjusts to each individual byDay correctly", () => {
    const dayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    const expectedDays = [0, 1, 2, 3, 4, 5, 6];
    const after = new Date("2026-03-10T19:00:00Z");

    for (let i = 0; i < dayCodes.length; i++) {
      const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: dayCodes[i] };
      const next = nextOccurrence(base, rule, after);
      expect(next.getDay()).toBe(expectedDays[i]);
      expect(next.getTime()).toBeGreaterThan(after.getTime());
    }
  });

  it("keeps advancing until result is after 'after'", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1 };
    const after = new Date("2026-04-01T00:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });

  it("handles byDay with invalid codes gracefully (falls back to no-byDay)", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "XX" };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString()).toBe("2026-03-17T18:00:00.000Z");
  });

  it("handles byDay with empty string (falls back to no-byDay)", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "" };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString()).toBe("2026-03-17T18:00:00.000Z");
  });

  it("returns base when base is already after 'after'", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1 };
    const before = new Date("2026-03-09T00:00:00Z");
    const next = nextOccurrence(base, rule, before);
    // base > before, so base is returned as-is
    expect(next.toISOString()).toBe("2026-03-10T18:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// nextOccurrence — weekly multi-day
// ---------------------------------------------------------------------------
describe("nextOccurrence — multiple byDay", () => {
  const base = new Date("2026-03-10T18:00:00Z"); // Tuesday

  it("returns the nearest upcoming day when multiple days selected", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "MO,WE" };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.getDay()).toBe(3); // Wednesday
    expect(next.toISOString().slice(0, 10)).toBe("2026-03-11");
  });

  it("advances past 'after' for multi-day rule", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "TU,TH" };
    const after = new Date("2026-03-12T00:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });

  it("handles three days per week", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "MO,WE,FR" };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString().slice(0, 10)).toBe("2026-03-11");
  });

  it("handles all 7 days selected (returns next day)", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: "MO,TU,WE,TH,FR,SA,SU" };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString().slice(0, 10)).toBe("2026-03-11");
  });

  it("multi-day with interval > 1 advances each day independently", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 2, byDay: "MO,FR" };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    // MO: base TU->MO=Mar9, +14=Mar23; FR: base TU->FR=Mar13, > after -> Mar13
    expect(next.toISOString().slice(0, 10)).toBe("2026-03-13");
    expect(next.getDay()).toBe(5); // Friday
  });

  it("handles byDay with whitespace around codes", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: " MO , WE " };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.getDay()).toBe(3); // Wednesday
  });
});

// ---------------------------------------------------------------------------
// nextOccurrence — monthly
// ---------------------------------------------------------------------------
describe("nextOccurrence — monthly", () => {
  const base = new Date("2026-03-10T18:00:00Z");

  it("advances monthly by 1 month", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1 };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString().slice(0, 10)).toBe("2026-04-10");
  });

  it("advances monthly by 2 months", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 2 };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString().slice(0, 10)).toBe("2026-05-10");
  });

  it("advances when after equals base", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1 };
    const next = nextOccurrence(base, rule, base);
    expect(next.toISOString().slice(0, 10)).toBe("2026-04-10");
  });

  it("handles month-end overflow (Jan 31 -> Feb)", () => {
    const jan31 = new Date("2026-01-31T18:00:00Z");
    const rule: RecurrenceRule = { freq: "monthly", interval: 1 };
    const after = new Date("2026-01-31T19:00:00Z");
    const next = nextOccurrence(jan31, rule, after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });

  it("skips multiple months to get past after", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1 };
    const after = new Date("2026-06-01T00:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
    expect(next.toISOString().slice(0, 7)).toBe("2026-06"); // June 10
  });
});

// ---------------------------------------------------------------------------
// nextOccurrence — yearly
// ---------------------------------------------------------------------------
describe("nextOccurrence — yearly", () => {
  const base = new Date("2026-03-10T18:00:00Z");

  it("advances yearly by 1 year", () => {
    const rule: RecurrenceRule = { freq: "yearly", interval: 1 };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString().slice(0, 10)).toBe("2027-03-10");
  });

  it("advances yearly by 2 years", () => {
    const rule: RecurrenceRule = { freq: "yearly", interval: 2 };
    const after = new Date("2026-03-10T19:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.toISOString().slice(0, 10)).toBe("2028-03-10");
  });

  it("advances when after equals base", () => {
    const rule: RecurrenceRule = { freq: "yearly", interval: 1 };
    const next = nextOccurrence(base, rule, base);
    expect(next.toISOString().slice(0, 10)).toBe("2027-03-10");
  });

  it("handles leap year (Feb 29)", () => {
    const feb29 = new Date("2028-02-29T18:00:00Z");
    const rule: RecurrenceRule = { freq: "yearly", interval: 1 };
    const after = new Date("2028-02-29T19:00:00Z");
    const next = nextOccurrence(feb29, rule, after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });

  it("skips multiple years to get past after", () => {
    const rule: RecurrenceRule = { freq: "yearly", interval: 1 };
    const after = new Date("2030-01-01T00:00:00Z");
    const next = nextOccurrence(base, rule, after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
    expect(next.toISOString().slice(0, 4)).toBe("2030");
  });
});

// ---------------------------------------------------------------------------
// nextOccurrence — invariant: result is always strictly after 'after'
// ---------------------------------------------------------------------------
describe("nextOccurrence — invariant: result > after for all freq types", () => {
  const base = new Date("2026-03-10T18:00:00Z");
  const after = new Date("2026-03-10T19:00:00Z");

  const rules: RecurrenceRule[] = [
    { freq: "daily", interval: 1 },
    { freq: "daily", interval: 5 },
    { freq: "weekly", interval: 1 },
    { freq: "weekly", interval: 3 },
    { freq: "weekly", interval: 1, byDay: "FR" },
    { freq: "weekly", interval: 1, byDay: "MO,WE,FR" },
    { freq: "monthly", interval: 1 },
    { freq: "monthly", interval: 4 },
    { freq: "yearly", interval: 1 },
    { freq: "yearly", interval: 3 },
  ];

  for (const rule of rules) {
    it(`${rule.freq} interval=${rule.interval} byDay=${rule.byDay ?? "none"}`, () => {
      const next = nextOccurrence(base, rule, after);
      expect(next.getTime()).toBeGreaterThan(after.getTime());
    });
  }
});

// ---------------------------------------------------------------------------
// describeRecurrenceRule — English
// ---------------------------------------------------------------------------
describe("describeRecurrenceRule — English", () => {
  it("describes every day", () => {
    expect(describeRecurrenceRule({ freq: "daily", interval: 1 }, "en")).toBe("Every day");
  });

  it("describes every N days", () => {
    expect(describeRecurrenceRule({ freq: "daily", interval: 3 }, "en")).toBe("Every 3 days");
  });

  it("describes every week", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 1 }, "en")).toBe("Every week");
  });

  it("describes every N weeks", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 3 }, "en")).toBe("Every 3 weeks");
  });

  it("describes every week on a day", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 1, byDay: "TU" }, "en")).toBe("Every week on Tuesday");
  });

  it("describes every N weeks on a day", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 2, byDay: "FR" }, "en")).toBe("Every 2 weeks on Friday");
  });

  it("describes every week on multiple days", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 1, byDay: "MO,WE" }, "en"))
      .toBe("Every week on Monday, Wednesday");
  });

  it("describes every N weeks on multiple days", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 2, byDay: "TU,TH" }, "en"))
      .toBe("Every 2 weeks on Tuesday, Thursday");
  });

  it("describes every week on all 7 days", () => {
    const result = describeRecurrenceRule({ freq: "weekly", interval: 1, byDay: "MO,TU,WE,TH,FR,SA,SU" }, "en");
    expect(result).toContain("Monday");
    expect(result).toContain("Sunday");
  });

  it("describes every month", () => {
    expect(describeRecurrenceRule({ freq: "monthly", interval: 1 }, "en")).toBe("Every month");
  });

  it("describes every N months", () => {
    expect(describeRecurrenceRule({ freq: "monthly", interval: 2 }, "en")).toBe("Every 2 months");
  });

  it("describes every year", () => {
    expect(describeRecurrenceRule({ freq: "yearly", interval: 1 }, "en")).toBe("Every year");
  });

  it("describes every N years", () => {
    expect(describeRecurrenceRule({ freq: "yearly", interval: 2 }, "en")).toBe("Every 2 years");
  });

  it("defaults to English when no locale given", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 1 })).toBe("Every week");
  });
});

// ---------------------------------------------------------------------------
// describeRecurrenceRule — Portuguese
// ---------------------------------------------------------------------------
describe("describeRecurrenceRule — Portuguese", () => {
  it("describes every day", () => {
    expect(describeRecurrenceRule({ freq: "daily", interval: 1 }, "pt")).toBe("Todos os dias");
  });

  it("describes every N days", () => {
    expect(describeRecurrenceRule({ freq: "daily", interval: 2 }, "pt")).toBe("De 2 em 2 dias");
  });

  it("describes every week", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 1 }, "pt")).toBe("Todas as semanas");
  });

  it("describes every N weeks", () => {
    expect(describeRecurrenceRule({ freq: "weekly", interval: 2 }, "pt")).toBe("De 2 em 2 semanas");
  });

  it("describes every month", () => {
    expect(describeRecurrenceRule({ freq: "monthly", interval: 1 }, "pt")).toBe("Todos os meses");
  });

  it("describes every year", () => {
    expect(describeRecurrenceRule({ freq: "yearly", interval: 1 }, "pt")).toBe("Todos os anos");
  });
});

// ---------------------------------------------------------------------------
// describeRecurrenceRule — all locales x all freq types smoke test
// ---------------------------------------------------------------------------
describe("describeRecurrenceRule — all locales produce non-empty strings", () => {
  const locales = ["en", "pt", "es", "fr", "de", "it"] as const;
  const rules: RecurrenceRule[] = [
    { freq: "daily", interval: 1 },
    { freq: "daily", interval: 3 },
    { freq: "weekly", interval: 1 },
    { freq: "weekly", interval: 2, byDay: "MO" },
    { freq: "weekly", interval: 1, byDay: "TU,TH" },
    { freq: "monthly", interval: 1 },
    { freq: "monthly", interval: 3 },
    { freq: "yearly", interval: 1 },
    { freq: "yearly", interval: 2 },
  ];

  for (const locale of locales) {
    for (const rule of rules) {
      it(`${locale}: ${rule.freq} interval=${rule.interval} byDay=${rule.byDay ?? "none"}`, () => {
        const result = describeRecurrenceRule(rule, locale);
        expect(result).toBeTruthy();
        expect(result.length).toBeGreaterThan(0);
        // Should not contain unresolved template placeholders
        expect(result).not.toContain("{n}");
        expect(result).not.toContain("{day}");
      });
    }
  }
});
