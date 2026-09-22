import { describe, it, expect } from "vitest";
import { deriveEventPermissions, canRemoveEventPlayer } from "~/lib/eventView";

const owned = { ownerId: "owner-1", isPublic: false };
const ownerlessUnlisted = { ownerId: null, isPublic: false };
const ownerlessPublic = { ownerId: null, isPublic: true };

describe("deriveEventPermissions", () => {
  it("grants full management to the owner", () => {
    const perms = deriveEventPermissions("owner-1", owned);
    expect(perms).toMatchObject({ isOwner: true, isAdmin: false, canEditSettings: true, canManageInvites: true });
  });

  it("grants full management to an admin", () => {
    const perms = deriveEventPermissions("admin-1", { ...owned, isAdmin: true });
    expect(perms).toMatchObject({ isOwner: false, isAdmin: true, canEditSettings: true, canManageInvites: true });
  });

  it("lets anyone manage an ownerless UNLISTED event (no-account flow)", () => {
    const perms = deriveEventPermissions(null, ownerlessUnlisted);
    expect(perms).toMatchObject({ isOwnerless: true, canEditSettings: true });
  });

  it("makes an ownerless PUBLIC event read-only until adopted (ADR 0035)", () => {
    const perms = deriveEventPermissions(null, ownerlessPublic);
    expect(perms).toMatchObject({ isOwnerless: true, canEditSettings: false, canManageInvites: false });
  });

  it("denies settings to a non-owner on an owned event", () => {
    const perms = deriveEventPermissions("someone-else", owned);
    expect(perms.canEditSettings).toBe(false);
  });

  it("allows an authenticated participant to edit teams", () => {
    const perms = deriveEventPermissions("player-1", owned, { isParticipant: true });
    expect(perms.canEditTeams).toBe(true);
  });

  it("denies team editing to anonymous viewers", () => {
    const perms = deriveEventPermissions(null, owned, { isParticipant: true });
    expect(perms.canEditTeams).toBe(false);
  });
});

describe("canRemoveEventPlayer", () => {
  it("lets the owner remove anyone", () => {
    expect(canRemoveEventPlayer("owner-1", owned, { userId: "someone" })).toBe(true);
  });

  it("lets a player remove themselves", () => {
    expect(canRemoveEventPlayer("player-1", owned, { userId: "player-1" })).toBe(true);
  });

  it("lets a non-owner remove an anonymous player (server skips the check)", () => {
    expect(canRemoveEventPlayer("player-1", owned, { userId: null })).toBe(true);
  });

  it("does not let a non-owner remove another account-linked player", () => {
    expect(canRemoveEventPlayer("player-1", owned, { userId: "someone-else" })).toBe(false);
  });
});
