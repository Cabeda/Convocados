/**
 * Announced on `window` when the notifications page changes what is read.
 *
 * The bell and the page are siblings with no shared store, and importing the
 * constant from one into the other closes a cycle (page → layout → bell → page),
 * so it lives here (#1560 review).
 */
export const NOTIFICATIONS_CHANGED = "notifications:changed";
