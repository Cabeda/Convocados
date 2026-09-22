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
 * remove only themselves.
 */
export function canRemoveEventPlayer(
  viewerUserId: string | null | undefined,
  event: EventPermissionEvent,
  player: { userId?: string | null },
): boolean {
  const { isOwner, isAdmin } = deriveEventPermissions(viewerUserId, event);
  if (isOwner || isAdmin) return true;
  return !!viewerUserId && player.userId === viewerUserId;
}
