import { describe, it, expect } from "vitest";
import { menuGroups, type MenuInput, type MenuItemId } from "~/lib/eventHeader";

const base: MenuInput = {
  canEdit: false, isOwnerless: false, isAuthenticated: false, ratingsOn: true,
  calendarOpen: true, showAttendance: true, canWatch: false, isCancelled: false,
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

  it("gives an admin Cancel game, Ratings and Settings", () => {
    const all = ids({ canEdit: true, isAuthenticated: true });
    expect(all).toEqual(expect.arrayContaining(["cancel", "ratings", "settings"] satisfies MenuItemId[]));
    expect(menuGroups({ ...base, canEdit: true }).at(-1)?.id).toBe("manage");
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
