import { createT, type Locale } from "./i18n";

export interface RecurrenceRule {
  freq: "weekly" | "monthly";
  interval: number;
  byDay?: string; // "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU"
}

const DAY_MAP: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

export function parseRecurrenceRule(json: string | null): RecurrenceRule | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as RecurrenceRule;
  } catch {
    return null;
  }
}

export function serializeRecurrenceRule(rule: RecurrenceRule): string {
  return JSON.stringify(rule);
}

export function nextOccurrence(base: Date, rule: RecurrenceRule, after: Date): Date {
  const result = new Date(base);

  if (rule.freq === "weekly") {
    if (rule.byDay && DAY_MAP[rule.byDay] !== undefined) {
      const targetDay = DAY_MAP[rule.byDay];
      const diff = (targetDay - result.getDay() + 7) % 7;
      result.setDate(result.getDate() + diff);
    }
    while (result <= after) {
      result.setDate(result.getDate() + 7 * rule.interval);
    }
  } else {
    while (result <= after) {
      result.setMonth(result.getMonth() + rule.interval);
    }
  }

  return result;
}

export function describeRecurrenceRule(rule: RecurrenceRule, locale: Locale = "en"): string {
  const t = createT(locale);
  const dayKeys: Record<string, "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday"> = {
    MO: "monday", TU: "tuesday", WE: "wednesday",
    TH: "thursday", FR: "friday", SA: "saturday", SU: "sunday",
  };

  if (rule.freq === "weekly") {
    const day = rule.byDay ? t(dayKeys[rule.byDay] ?? "monday") : null;
    if (rule.interval === 1) {
      return day ? t("everyWeekOn", { day }) : t("everyWeek");
    }
    return day
      ? t("everyNWeeksOn", { n: rule.interval, day })
      : t("everyNWeeks", { n: rule.interval });
  }
  return rule.interval === 1 ? t("everyMonth") : t("everyNMonths", { n: rule.interval });
}
