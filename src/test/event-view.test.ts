import { describe, it, expect } from "vitest";
import { deriveEventPermissions, canRemoveEventPlayer, findSelfRosterRow } from "~/lib/eventView";

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

describe("findSelfRosterRow (#1269 — self-leave on a name-only row)", () => {
  const viewer = { id: "u-1", name: "José Silva" };

  it("prefers the linked row (userId match) whatever the row is called", () => {
    const rows = [
      { id: "p-a", name: "Ze", userId: "u-1" },
      { id: "p-b", name: "José Silva", userId: null },
    ];
    expect(findSelfRosterRow(rows, viewer)?.id).toBe("p-a");
  });

  it("falls back to an unlinked row whose name matches under normalizeForMatch", () => {
    const rows = [
      { id: "p-a", name: "Bob", userId: null },
      { id: "p-b", name: "Jose SILVA", userId: null },
    ];
    expect(findSelfRosterRow(rows, viewer)?.id).toBe("p-b");
  });

  it("returns null when no roster row matches", () => {
    expect(findSelfRosterRow([{ id: "p-a", name: "Bob", userId: null }], viewer)).toBeNull();
  });

  it("never matches a row already linked to a different account", () => {
    const rows = [{ id: "p-a", name: "José Silva", userId: "u-someone-else" }];
    expect(findSelfRosterRow(rows, viewer)).toBeNull();
  });

  it("returns null without a signed-in viewer or a display name", () => {
    const rows = [{ id: "p-a", name: "José Silva", userId: null }];
    expect(findSelfRosterRow(rows, null)).toBeNull();
    expect(findSelfRosterRow(rows, { id: "u-1", name: null })).toBeNull();
  });

  it("grants no new authority — the matched row is unlinked, so the X already allows it", () => {
    const rows = [{ id: "p-a", name: "José Silva", userId: null }];
    const matched = findSelfRosterRow(rows, viewer);
    expect(matched).not.toBeNull();
    expect(matched!.userId).toBeNull();
    expect(canRemoveEventPlayer("u-1", owned, matched!)).toBe(true);
    // …and so does every other viewer, which is exactly the pre-existing X rule.
    expect(canRemoveEventPlayer("someone-else", owned, matched!)).toBe(true);
  });
});
