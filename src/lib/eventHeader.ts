import { createT, type Locale } from "./i18n";
import type { RecurrenceRule } from "./recurrence";
import { dateFormatTag, formatDateInTz } from "./timezones";

/**
 * What the ⋮ sheet on the event page offers, as data: one list per group, in
 * reading order. Pure so every visibility rule is a unit test, not a click-through.
 */
export type MenuItemId =
  | "ics" | "gcal" | "cancel"
  | "history" | "seasons" | "attendance" | "log" | "ratings" | "payments" | "watch"
  | "notifications" | "settings";

export type MenuGroupId = "game" | "back" | "you" | "manage";

export interface MenuGroup { id: MenuGroupId; items: MenuItemId[] }

export interface MenuInput {
  /** Owner or event admin. */
  canEdit: boolean;
  isOwnerless: boolean;
  isAuthenticated: boolean;
  /** Skill ratings are enabled for this event. */
  ratingsOn: boolean;
  /** The game has not ended yet, so a calendar entry still makes sense. */
  calendarOpen: boolean;
  /** The game is over or repeats, so there is attendance to look at. */
  showAttendance: boolean;
  /** Phone with teams drawn: the watch scorer can start. */
  canWatch: boolean;
  isCancelled: boolean;
}

export function menuGroups(i: MenuInput): MenuGroup[] {
  const game: MenuItemId[] = [
    ...(i.calendarOpen ? (["ics", "gcal"] as const) : []),
    ...(i.canEdit && !i.isCancelled ? (["cancel"] as const) : []),
  ];
  const back: MenuItemId[] = [
    "history", "seasons",
    ...(i.showAttendance ? (["attendance"] as const) : []),
    "log",
    ...(i.canEdit && !i.isOwnerless && i.ratingsOn ? (["ratings"] as const) : []),
    "payments",
    ...(i.canWatch ? (["watch"] as const) : []),
  ];
  const you: MenuItemId[] = i.isAuthenticated ? ["notifications"] : [];
  const manage: MenuItemId[] = i.canEdit ? ["settings"] : [];
  const groups: MenuGroup[] = [
    { id: "game", items: game }, { id: "back", items: back },
    { id: "you", items: you }, { id: "manage", items: manage },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Who may ask the server for the price: the same people it will answer (see `canReadEventFinances`). */
export function canViewPrice(i: { canEdit: boolean; isParticipant: boolean; isOwnerless: boolean; isPublic: boolean }): boolean {
  return i.canEdit || i.isParticipant || (i.isOwnerless && !i.isPublic);
}

export interface ScheduleInput {
  rule: RecurrenceRule | null;
  gameDate: Date;
  timezone: string;
  durationMinutes?: number | null;
  /** A one-off whose game is over: say when it was, not when it starts. */
  ended: boolean;
  locale: Locale;
}

const WEEKDAY_ORDER = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** A short weekday in the viewer's language. 2023-01-01 was a Sunday, so day 0 + n is weekday n. */
const weekdayShort = (code: string, locale: Locale): string => {
  const n = WEEKDAY_ORDER.indexOf(code.trim());
  return new Intl.DateTimeFormat(dateFormatTag(locale), { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + Math.max(n, 0))));
};

/**
 * The "when" line under the title as plain facts joined by dots, with no sentence to get wrong
 * in any language: "Weekly · Fri 20:49 · 90 min", "Fri, 4 Dec · 20:49", "Ended Fri, 4 Dec".
 * The words come from Intl, so casing and abbreviations follow each language.
 */
export function scheduleLabel(i: ScheduleInput, t: ReturnType<typeof createT>): string {
  const day = (opts: Intl.DateTimeFormatOptions) => formatDateInTz(i.gameDate, i.locale, i.timezone, opts);
  const time = day({ hour: "2-digit", minute: "2-digit" });
  const length = i.durationMinutes ? t("headerDuration", { n: i.durationMinutes }) : null;

  if (i.rule) {
    const { freq, interval, byDay } = i.rule;
    if (freq === "weekly") {
      const days = byDay ? byDay.split(",").map((d) => weekdayShort(d, i.locale)).join(", ") : day({ weekday: "short" });
      const every = interval === 1 ? t("headerWeekly") : t("everyNWeeks", { n: interval });
      return [every, `${days} ${time}`, length].filter(Boolean).join(" · ");
    }
    const every = freq === "daily" ? (interval === 1 ? t("everyDay") : t("everyNDays", { n: interval }))
      : freq === "yearly" ? (interval === 1 ? t("everyYear") : t("everyNYears", { n: interval }))
        : (interval === 1 ? t("everyMonth") : t("everyNMonths", { n: interval }));
    const when = freq === "daily" ? time : `${day({ day: "numeric", month: "short" })} ${time}`;
    return [every, when, length].filter(Boolean).join(" · ");
  }

  const date = day({ weekday: "short", day: "numeric", month: "short" });
  if (i.ended) return t("headerEnded", { when: date });
  return [date, time, length].filter(Boolean).join(" · ");
}
