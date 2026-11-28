import { describe, it, expect } from "vitest";
import { teamTitle, viewerTeamIndex, drawGate, drawStep, showRatings, playAgainView } from "~/lib/teamsView";

describe("teamTitle", () => {
  it("calls the stock names 'Team 1' and 'Team 2' and keeps names a group chose", () => {
    expect(teamTitle("Ninjas", 0)).toEqual({ custom: false });
    expect(teamTitle("Gunas", 1)).toEqual({ custom: false });
    expect(teamTitle("Lions", 0)).toEqual({ custom: true, name: "Lions" });
    // The stock name of the OTHER side is a choice here.
    expect(teamTitle("Gunas", 0)).toEqual({ custom: true, name: "Gunas" });
  });
});

describe("viewerTeamIndex", () => {
  const teams = [{ members: [{ name: "Ana M" }] }, { members: [{ name: "Jose Silva" }, { name: "Rui" }] }];
  const players = [{ id: "1", name: "Ana M", userId: null }, { id: "2", name: "Jose Silva", userId: "u-1" }];

  it("finds the team through the linked account", () => {
    expect(viewerTeamIndex(teams, players, { id: "u-1", name: "Someone Else" })).toBe(1);
  });
  it("falls back to a row with the viewer's name and no account, never to someone else's linked row", () => {
    expect(viewerTeamIndex(teams, players, { id: "u-9", name: "ana m" })).toBe(0);
    expect(viewerTeamIndex(teams, [{ id: "2", name: "Jose Silva", userId: "u-2" }], { id: "u-1", name: "Jose Silva" })).toBeNull();
  });
  it("is null for a signed-out viewer or one who is not in a team", () => {
    expect(viewerTeamIndex(teams, players, null)).toBeNull();
    expect(viewerTeamIndex(teams, players, { id: "u-5", name: "Nobody" })).toBeNull();
  });
});

describe("drawGate", () => {
  it("is open with two names or more and says why it is shut below", () => {
    expect(drawGate(1)).toEqual({ ok: false, reason: "needTwo" });
    expect(drawGate(0)).toEqual({ ok: false, reason: "needTwo" });
    expect(drawGate(2)).toEqual({ ok: true });
  });
});

describe("drawStep", () => {
  it("asks before replacing teams, asks before drawing with a short list, and otherwise just draws", () => {
    expect(drawStep({ hasTeams: true, count: 16, max: 16 })).toBe("redraw");
    expect(drawStep({ hasTeams: true, count: 9, max: 16 })).toBe("redraw");
    expect(drawStep({ hasTeams: false, count: 9, max: 16 })).toBe("early");
    expect(drawStep({ hasTeams: false, count: 16, max: 16 })).toBe("now");
  });
});

describe("showRatings", () => {
  it("shows numbers only for a balanced game whose organizer did not hide them", () => {
    expect(showRatings({ balanced: true, hideEloInTeams: false })).toBe(true);
    expect(showRatings({ balanced: true, hideEloInTeams: true })).toBe(false);
    expect(showRatings({ balanced: false, hideEloInTeams: false })).toBe(false);
  });
});

describe("playAgainView", () => {
  const base = { canManage: true, ownerName: "Sam" };
  it("offers a manager both ways to play again", () => {
    expect(playAgainView(base)).toEqual({ kind: "manage" });
  });
  it("tells everyone else who to ask", () => {
    expect(playAgainView({ canManage: false, ownerName: "Sam" })).toEqual({ kind: "ask", owner: "Sam" });
    expect(playAgainView({ canManage: false, ownerName: null })).toEqual({ kind: "ask", owner: null });
  });
});
