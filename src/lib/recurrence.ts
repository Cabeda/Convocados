import { createT, type Locale } from "./i18n";

export interface RecurrenceRule {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  byDay?: string; // single or comma-separated: "MO" | "MO,WE" | "MO,WE,FR" etc.
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
  if (rule.freq === "daily") {
    const result = new Date(base);
    while (result <= after) result.setDate(result.getDate() + rule.interval);
    return result;
  }

  if (rule.freq === "weekly") {
    const days = rule.byDay
      ? rule.byDay.split(",").map((d) => d.trim()).filter((d) => DAY_MAP[d] !== undefined)
      : [];

    if (days.length === 0) {
      const result = new Date(base);
      while (result <= after) result.setDate(result.getDate() + 7 * rule.interval);
      return result;
    }

    if (days.length === 1) {
      const result = new Date(base);
      const targetDay = DAY_MAP[days[0]];
      const diff = (targetDay - result.getDay() + 7) % 7;
      result.setDate(result.getDate() + diff);
      while (result <= after) result.setDate(result.getDate() + 7 * rule.interval);
      return result;
    }

    // Multiple days: return the nearest upcoming occurrence across all selected days
    let best: Date | null = null;
    for (const day of days) {
      const candidate = new Date(base);
      const targetDay = DAY_MAP[day];
      const diff = (targetDay - candidate.getDay() + 7) % 7;
      candidate.setDate(candidate.getDate() + diff);
      while (candidate <= after) candidate.setDate(candidate.getDate() + 7 * rule.interval);
      if (!best || candidate < best) best = candidate;
    }
    return best!;
  }

  if (rule.freq === "yearly") {
    const result = new Date(base);
    while (result <= after) result.setFullYear(result.getFullYear() + rule.interval);
    return result;
  }

  // monthly
  const result = new Date(base);
  while (result <= after) result.setMonth(result.getMonth() + rule.interval);
  return result;
}

export function describeRecurrenceRule(rule: RecurrenceRule, locale: Locale = "en"): string {
  const t = createT(locale);
  const dayKeys: Record<string, "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday"> = {
    MO: "monday", TU: "tuesday", WE: "wednesday",
    TH: "thursday", FR: "friday", SA: "saturday", SU: "sunday",
  };

  if (rule.freq === "daily") {
    return rule.interval === 1 ? t("everyDay") : t("everyNDays", { n: rule.interval });
  }

  if (rule.freq === "weekly") {
    const dayLabel = rule.byDay
      ? rule.byDay.split(",").map((d) => t(dayKeys[d.trim()] ?? "monday")).join(", ")
      : null;
    if (rule.interval === 1) {
      return dayLabel ? t("everyWeekOn", { day: dayLabel }) : t("everyWeek");
    }
    return dayLabel
      ? t("everyNWeeksOn", { n: rule.interval, day: dayLabel })
      : t("everyNWeeks", { n: rule.interval });
  }

  if (rule.freq === "yearly") {
    return rule.interval === 1 ? t("everyYear") : t("everyNYears", { n: rule.interval });
  }

  return rule.interval === 1 ? t("everyMonth") : t("everyNMonths", { n: rule.interval });
}
