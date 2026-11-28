import { describe, it, expect } from "vitest";
import { menuGroups, scheduleLabel, canViewPrice, type MenuInput, type MenuItemId } from "~/lib/eventHeader";
import { createT } from "~/lib/i18n";

const base: MenuInput = {
  canEdit: false, isOwnerless: false, isAuthenticated: false, ratingsOn: true,
  calendarOpen: true, showAttendance: true, canWatch: false, isCancelled: false, paymentsReachable: true,
};
const ids = (i: Partial<MenuInput>) => menuGroups({ ...base, ...i }).flatMap((g) => g.items);
const groups = (i: Partial<MenuInput>) => menuGroups({ ...base, ...i }).map((g) => g.id);

describe("menuGroups", () => {
  it("gives a signed-out player the calendar and the look-back pages, nothing personal or admin", () => {
    expect(ids({})).toEqual(["ics", "gcal", "history", "seasons", "attendance", "log", "payments"]);
    expect(groups({})).toEqual(["game", "back"]);
  });

  it("adds My notifications for a signed-in viewer", () => {
    expect(ids({ isAuthenticated: true })).toContain("notifications");
    expect(groups({ isAuthenticated: true })).toEqual(["game", "back", "you"]);
  });

  it("gives an admin Settings and, below it, Cancel game, in the Manage group", () => {
    const all = ids({ canEdit: true, isAuthenticated: true });
    expect(all).toEqual(expect.arrayContaining(["cancel", "ratings", "settings"] satisfies MenuItemId[]));
    const manage = menuGroups({ ...base, canEdit: true }).at(-1);
    expect(manage).toEqual({ id: "manage", items: ["lineup", "settings", "cancel"] });
  });

  it("leaves Payments out where the page would only say sign in or players only", () => {
    expect(ids({ paymentsReachable: false })).not.toContain("payments");
    expect(ids({ paymentsReachable: true })).toContain("payments");
  });

  it("puts Manage lineup in the Manage group for the organizer only, before Settings", () => {
    expect(menuGroups({ ...base, canEdit: true }).at(-1)).toEqual({ id: "manage", items: ["lineup", "settings", "cancel"] });
    expect(ids({ canEdit: false, isAuthenticated: true })).not.toContain("lineup");
  });

  it("keeps Ratings off ownerless events and off events with ratings disabled", () => {
    expect(ids({ canEdit: true, isOwnerless: true })).not.toContain("ratings");
    expect(ids({ canEdit: true, ratingsOn: false })).not.toContain("ratings");
  });

  it("hides the calendar rows once the game is over", () => {
    expect(ids({ calendarOpen: false })).not.toContain("ics");
    expect(ids({ calendarOpen: false })).not.toContain("gcal");
  });

  it("hides Attendance when there is nothing to look back on", () => {
    expect(ids({ showAttendance: false })).not.toContain("attendance");
  });

  it("offers Watch score only when it can be used", () => {
    expect(ids({ canWatch: true })).toContain("watch");
    expect(ids({ canWatch: false })).not.toContain("watch");
  });

  it("does not offer Cancel game on a game that is already cancelled", () => {
    expect(ids({ canEdit: true, isCancelled: true })).not.toContain("cancel");
  });

  it("drops a group instead of showing it empty", () => {
    expect(groups({ calendarOpen: false })).toEqual(["back"]);
  });
});

describe("scheduleLabel", () => {
  // Friday 4 Dec 2026, 20:49 in Lisbon (winter, UTC+0).
  const friday = new Date("2026-12-04T20:49:00Z");
  const label = (o: Partial<Parameters<typeof scheduleLabel>[0]> = {}, locale: "en" | "pt" | "de" = "en") =>
    scheduleLabel({ rule: null, gameDate: friday, timezone: "Europe/Lisbon", durationMinutes: 90, ended: false, locale, ...o }, createT(locale));

  it("says a weekly game as three plain facts, with no sentence to get wrong", () => {
    expect(label({ rule: { freq: "weekly", interval: 1, byDay: "FR" } })).toBe("Weekly · Fri 20:49 · 90 min");
  });

  it("lets Intl write the weekday, so no locale gets a capital in the middle of a sentence or an `à … às`", () => {
    const pt = label({ rule: { freq: "weekly", interval: 1, byDay: "FR" } }, "pt");
    expect(pt).toMatch(/^Semanal · sex\w*\.? 20:49 · 90 min$/);
    expect(pt).not.toMatch(/ à | às /);
  });

  it("lists several weekdays once", () => {
    expect(label({ rule: { freq: "weekly", interval: 1, byDay: "TU,FR" } })).toBe("Weekly · Tue, Fri 20:49 · 90 min");
  });

  it("names the date of a one-off, with no `at`", () => {
    expect(label()).toBe("Fri 4 Dec · 20:49 · 90 min");
  });

  it("says Ended and the date for a one-off whose game is over, and no time or length", () => {
    expect(label({ ended: true })).toBe("Ended Fri 4 Dec");
  });

  it("leaves the length out when there is none", () => {
    expect(label({ durationMinutes: null })).toBe("Fri 4 Dec · 20:49");
  });
});

describe("canViewPrice", () => {
  it("is for the organiser, a linked player, and the link-is-the-key game nobody owns", () => {
    expect(canViewPrice({ canEdit: true, isParticipant: false, isOwnerless: false, isPublic: false })).toBe(true);
    expect(canViewPrice({ canEdit: false, isParticipant: true, isOwnerless: false, isPublic: false })).toBe(true);
    expect(canViewPrice({ canEdit: false, isParticipant: false, isOwnerless: true, isPublic: false })).toBe(true);
  });

  it("is not for a bystander, whom the server would refuse with a 403 on every load", () => {
    expect(canViewPrice({ canEdit: false, isParticipant: false, isOwnerless: false, isPublic: false })).toBe(false);
    expect(canViewPrice({ canEdit: false, isParticipant: false, isOwnerless: true, isPublic: true })).toBe(false);
  });
});
