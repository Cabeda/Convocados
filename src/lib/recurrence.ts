import { createT, type Locale } from "./i18n";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "./timezones";

export interface RecurrenceRule {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  byDay?: string; // single or comma-separated: "MO" | "MO,WE" | "MO,WE,FR" etc.
  /** Day-of-month a monthly/yearly series is anchored to (1-31). Kept apart
   *  from the current occurrence so a short month clamps to Feb 28 without
   *  moving the series permanently onto the 28th. */
  anchorDay?: number;
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

/** The wall-clock day-of-month of [date] in [timezone]. */
export function anchorDayOf(date: Date, timezone?: string): number {
  return toCivilPseudo(date, timezone || "UTC").getUTCDate();
}

/** Build a rule anchored to the day-of-month [dateTime] falls on in [timezone].
 *  Monthly and yearly series then clamp a short month (Feb 28) yet return to
 *  their original day (Mar 31) on the next occurrence. Daily/weekly ignore it. */
export function buildRecurrenceRule(
  rule: Omit<RecurrenceRule, "anchorDay">,
  dateTime: Date,
  timezone?: string,
): RecurrenceRule {
  if (rule.freq !== "monthly" && rule.freq !== "yearly") return rule;
  return { ...rule, anchorDay: anchorDayOf(dateTime, timezone) };
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

  // Monthly and yearly arithmetic is anchored to the series' original
  // day-of-month. `setUTCMonth`/`setUTCFullYear` roll a short month over
  // (Jan 31 + 1 month = Mar 3), which skipped February and then made the
  // rolled date the new base for every later occurrence. Clamp to the last
  // day of the target month instead, and count from the anchor rather than
  // from the clamped result so the series returns to its day afterwards.
  const step = Number.isFinite(rule.interval) && rule.interval > 0
    ? Math.floor(rule.interval)
    : 1;
  // Clamp the anchor itself: a rule read back from storage is untrusted JSON,
  // and setUTCDate(0) would land on the previous month's last day.
  const anchorDay = Math.min(31, Math.max(1,
    typeof rule.anchorDay === "number" && Number.isFinite(rule.anchorDay)
      ? rule.anchorDay
      : baseCivil.getUTCDate(),
  ));
  const hours = baseCivil.getUTCHours();
  const minutes = baseCivil.getUTCMinutes();
  const seconds = baseCivil.getUTCSeconds();

  if (rule.freq === "yearly") {
    let result = new Date(baseCivil);
    let years = 0;
    while (toInstant(result).getTime() <= afterMs) {
      years += step;
      const year = baseCivil.getUTCFullYear() + years;
      const month = baseCivil.getUTCMonth();
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      result = new Date(Date.UTC(year, month, Math.min(anchorDay, daysInMonth), hours, minutes, seconds));
    }
    return toInstant(result);
  }

  // monthly
  let result = new Date(baseCivil);
  let months = 0;
  while (toInstant(result).getTime() <= afterMs) {
    months += step;
    const monthStart = new Date(Date.UTC(
      baseCivil.getUTCFullYear(),
      baseCivil.getUTCMonth() + months,
      1, hours, minutes, seconds,
    ));
    const daysInMonth = new Date(Date.UTC(
      monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0,
    )).getUTCDate();
    monthStart.setUTCDate(Math.min(anchorDay, daysInMonth));
    result = monthStart;
  }
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
