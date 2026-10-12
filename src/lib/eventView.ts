/**
 * Event view model — the pure, shared derivation of what an Event viewer may
 * do. Encodes the same policy the server enforces (ADR 0035): Owner/Admin may
 * manage an Event; an ownerless UNLISTED Event is open (the share link is the
 * capability); an ownerless PUBLIC Event (a discoverable Open Pickup) is
 * read-only until adopted.
 *
 * The islands previously re-derived these rules inline, which is how the client
 * drifted from the server. Keeping them here makes the rules testable and lets
 * the client and server share one definition.
 */

import { normalizeForMatch } from "./stringMatch";

export interface EventPermissionEvent {
  ownerId: string | null;
  isPublic: boolean;
  /** Whether the viewer is an admin of this event (server-provided). */
  isAdmin?: boolean;
}

export interface EventPermissions {
  isAuthenticated: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isOwnerless: boolean;
  /** Viewer is on the current player list (used for team editing). */
  isParticipant: boolean;
  /** Owner/Admin, or an ownerless unlisted event (ADR 0035). */
  canEditSettings: boolean;
  canManageInvites: boolean;
  canEditTeams: boolean;
}

export interface EventPermissionsContext {
  isParticipant?: boolean;
}

export function deriveEventPermissions(
  viewerUserId: string | null | undefined,
  event: EventPermissionEvent,
  context: EventPermissionsContext = {},
): EventPermissions {
  const isAuthenticated = !!viewerUserId;
  const isOwner = !!(viewerUserId && event.ownerId && viewerUserId === event.ownerId);
  const isAdmin = !!event.isAdmin;
  const isOwnerless = event.ownerId === null;
  const ownerlessOpen = isOwnerless && !event.isPublic;
  const isParticipant = !!context.isParticipant;

  return {
    isAuthenticated,
    isOwner,
    isAdmin,
    isOwnerless,
    isParticipant,
    canEditSettings: isOwner || isAdmin || ownerlessOpen,
    canManageInvites: isOwner || isAdmin,
    canEditTeams: isAuthenticated && (isOwner || isAdmin || isParticipant),
  };
}

/**
 * Whether the viewer may remove a specific player from the list. Mirrors
 * `DELETE /api/events/:id/players`: Owner/Admin may remove anyone; a player may
 * remove only themselves; and an anonymous player (no linked account) is
 * unprotected — the server skips the authorization check for them entirely.
 */
export function canRemoveEventPlayer(
  viewerUserId: string | null | undefined,
  event: EventPermissionEvent,
  player: { userId?: string | null },
): boolean {
  const { isOwner, isAdmin } = deriveEventPermissions(viewerUserId, event);
  if (isOwner || isAdmin) return true;
  if (viewerUserId && player.userId === viewerUserId) return true;
  if (!player.userId) return true;
  return false;
}

/**
 * Which row of the CURRENT roster is the signed-in viewer (#1269).
 *
 * A row carries a `userId` only when it is linked to an account; an organizer-added
 * anonymous player has none, so `userId` matching alone leaves those viewers with no
 * self-leave affordance. When there is no linked row, fall back to the repo's own
 * name normalization — the same rule invite/suggestion resolution uses — but ONLY on
 * rows that are unlinked: a name is the strongest claim available, and claiming a row
 * that belongs to someone else's account would be an identity guess.
 *
 * This grants no new authority: `canRemoveEventPlayer` already returns true for any
 * viewer on an unlinked row, so the affordance only names a row the X could remove.
 */
export function findSelfRosterRow<T extends { name: string; userId?: string | null }>(
  players: T[],
  viewer: { id: string; name?: string | null } | null | undefined,
): T | null {
  if (!viewer?.id) return null;
  const linked = players.find((p) => p.userId === viewer.id);
  if (linked) return linked;
  if (!viewer.name) return null;
  const wanted = normalizeForMatch(viewer.name);
  return players.find((p) => !p.userId && normalizeForMatch(p.name) === wanted) ?? null;
}
