import { describe, it, expect } from "vitest";
import { ApiError } from "~/lib/api/client";
import { createT } from "~/lib/i18n";
import { inviteErrorMessage, rosterErrorMessage } from "~/components/event/story/rosterErrors";

const t = createT("en");
const err = (status: number, serverMessage = "", payload?: unknown) => new ApiError(serverMessage || `HTTP ${status}`, status, payload, serverMessage || undefined);
const roster = (e: unknown) => rosterErrorMessage(e, t, { maxPlayers: 10, fallback: "FALLBACK", name: "Rui" });
const invite = (e: unknown) => inviteErrorMessage(e, t, { name: "Rui", fallback: "FALLBACK" });

describe("rosterErrorMessage — what a failed add says, in plain words", () => {
  it("names a duplicate", () => expect(roster(err(409, "x", { code: "ALREADY_IN_ROSTER" }))).toBe("Rui is already in the list."));
  it("says the game was cancelled", () => expect(roster(err(409, "This game was cancelled."))).toBe("Nobody can join or be added any more."));
  it("says the game has ended", () => expect(roster(err(403, "The game already ended."))).toBe("This game has ended, so the list is closed."));
  it("says the bench is full, with the limit", () => expect(roster(err(400, "The bench is full."))).toMatch(/10/));
  it("says to wait on a rate limit", () => expect(roster(err(429, "slow down"))).toBe("Too many tries in a row. Wait a minute and try again."));
  it("never shows the server's own sentence, and falls back for anything else", () => {
    expect(roster(err(500, "SQLITE_BUSY"))).toBe("FALLBACK");
    expect(roster(new Error("boom"))).toBe("FALLBACK");
    expect(roster(undefined)).toBe("FALLBACK");
  });
});

describe("inviteErrorMessage — the same plain words on the invite path", () => {
  it("says to wait on a rate limit: the same sentence as adding a name", () => {
    expect(invite(err(429, "Too many requests"))).toBe("Too many tries in a row. Wait a minute and try again.");
    expect(invite(err(429, "Too many requests"))).toBe(roster(err(429)));
  });
  it("says who may invite when the server says 403", () => expect(invite(err(403, "Only the owner, an admin, or a player of this event can send invites."))).toBe("Only people in this game and the organizer can invite."));
  it("names a person who is already on the list (409)", () => expect(invite(err(409, "This player is already on the player list."))).toBe("Rui is already in the list."));
  it("says when the person already said they cannot make it (409)", () => expect(invite(err(409, "This player declined this game."))).toBe("Rui said they can't make it."));
  it("says the game has started or ended (400)", () => expect(invite(err(400, "This game has already started."))).toBe("This game has ended, so the list is closed."));
  it("falls back for anything else, and for a failure that never reached the server", () => {
    expect(invite(err(500, "x"))).toBe("FALLBACK");
    expect(invite(new TypeError("Failed to fetch"))).toBe("FALLBACK");
  });
});
