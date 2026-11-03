import { createT, type Locale } from "./i18n";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "./timezones";

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

/** Convert an instant to a "civil pseudo-Date" whose UTC fields are the
 *  wall-clock fields of that instant in [tz]. Recurrence arithmetic then runs
 *  in civil time (so a weekly game stays at 19:00 local across DST), while the
 *  final result is converted back to a real instant with the offset in force on
 *  that day. */
function toCivilPseudo(date: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return new Date(Date.UTC(
    Number(get("year")), Number(get("month")) - 1, Number(get("day")),
    Number(hour), Number(get("minute")), Number(get("second")),
  ));
}

/** Convert a civil pseudo-Date (UTC fields = wall clock) back to a real
 *  instant in [tz], honouring the offset (incl. DST) in force that day. */
function civilPseudoToInstant(pseudo: Date, tz: string): Date {
  const y = pseudo.getUTCFullYear();
  const m = String(pseudo.getUTCMonth() + 1).padStart(2, "0");
  const d = String(pseudo.getUTCDate()).padStart(2, "0");
  const h = String(pseudo.getUTCHours()).padStart(2, "0");
  const min = String(pseudo.getUTCMinutes()).padStart(2, "0");
  const localValue = `${y}-${m}-${d}T${h}:${min}`;
  const zone = tz || "UTC";
  const result = new Date(fromDateTimeLocalValue(localValue, zone));
  // If the wall time does not exist (spring-forward gap) or is ambiguous,
  // fromDateTimeLocalValue cannot round-trip it. Fall forward to the nearest
  // valid post-transition time instead of returning an off-by-an-hour instant.
  if (toDateTimeLocalValue(result, zone) !== localValue) {
    const shifted = `${y}-${m}-${d}T${String((pseudo.getUTCHours() + 1) % 24).padStart(2, "0")}:${min}`;
    // Carry the day over when the hour wraps past midnight.
    const carryDay = pseudo.getUTCHours() === 23;
    const shiftedDate = carryDay
      ? new Date(Date.UTC(y, pseudo.getUTCMonth(), pseudo.getUTCDate() + 1))
      : null;
    const shiftedLocal = shiftedDate
      ? `${shiftedDate.getUTCFullYear()}-${String(shiftedDate.getUTCMonth() + 1).padStart(2, "0")}-${String(shiftedDate.getUTCDate()).padStart(2, "0")}T${String((pseudo.getUTCHours() + 1) % 24).padStart(2, "0")}:${min}`
      : shifted;
    return new Date(fromDateTimeLocalValue(shiftedLocal, zone));
  }
  return result;
}

export function nextOccurrence(base: Date, rule: RecurrenceRule, after: Date, timezone?: string): Date {
  const tz = timezone || "UTC";
  const baseCivil = toCivilPseudo(base, tz);
  const afterMs = after.getTime();

  const toInstant = (civil: Date) => civilPseudoToInstant(civil, tz);

  if (rule.freq === "daily") {
    const result = new Date(baseCivil);
    while (toInstant(result).getTime() <= afterMs) result.setUTCDate(result.getUTCDate() + rule.interval);
    return toInstant(result);
  }

  if (rule.freq === "weekly") {
    const days = rule.byDay
      ? rule.byDay.split(",").map((d) => d.trim()).filter((d) => DAY_MAP[d] !== undefined)
      : [];

    if (days.length === 0) {
      const result = new Date(baseCivil);
      while (toInstant(result).getTime() <= afterMs) result.setUTCDate(result.getUTCDate() + 7 * rule.interval);
      return toInstant(result);
    }

    if (days.length === 1) {
      const result = new Date(baseCivil);
      const targetDay = DAY_MAP[days[0]];
      const diff = (targetDay - result.getUTCDay() + 7) % 7;
      result.setUTCDate(result.getUTCDate() + diff);
      while (toInstant(result).getTime() <= afterMs) result.setUTCDate(result.getUTCDate() + 7 * rule.interval);
      return toInstant(result);
    }

    // Multiple days: return the nearest upcoming occurrence across all selected days
    let best: Date | null = null;
    for (const day of days) {
      const candidate = new Date(baseCivil);
      const targetDay = DAY_MAP[day];
      const diff = (targetDay - candidate.getUTCDay() + 7) % 7;
      candidate.setUTCDate(candidate.getUTCDate() + diff);
      while (toInstant(candidate).getTime() <= afterMs) candidate.setUTCDate(candidate.getUTCDate() + 7 * rule.interval);
      const candInst = toInstant(candidate);
      if (!best || candInst.getTime() < best.getTime()) best = candInst;
    }
    return best ?? toInstant(new Date(baseCivil));
  }

  if (rule.freq === "yearly") {
    const result = new Date(baseCivil);
    while (toInstant(result).getTime() <= afterMs) result.setUTCFullYear(result.getUTCFullYear() + rule.interval);
    return toInstant(result);
  }

  // monthly
  const result = new Date(baseCivil);
  while (toInstant(result).getTime() <= afterMs) result.setUTCMonth(result.getUTCMonth() + rule.interval);
  return toInstant(result);
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
