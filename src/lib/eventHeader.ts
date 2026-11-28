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
