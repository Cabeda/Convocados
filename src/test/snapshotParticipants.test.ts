import { describe, expect, it } from "vitest";
import {
  namesFromPaymentsSnapshot,
  namesFromTeamsSnapshot,
  isHistoryParticipant,
  isNameInPaymentsSnapshot,
  isNameInTeamsSnapshot,
} from "../lib/snapshotParticipants";

const teams = JSON.stringify([
  { team: "Team A", players: [{ name: "Alice" }, { name: "Bob" }] },
  { team: "Team B", players: [{ name: "Carol" }] },
]);

describe("namesFromTeamsSnapshot", () => {
  it("flattens all team player names", () => {
    expect(namesFromTeamsSnapshot(teams)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("returns empty array for null or undefined", () => {
    expect(namesFromTeamsSnapshot(null)).toEqual([]);
    expect(namesFromTeamsSnapshot(undefined)).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(namesFromTeamsSnapshot("not-json")).toEqual([]);
    expect(namesFromTeamsSnapshot("{}")).toEqual([]);
  });

  it("returns empty array for an empty snapshot", () => {
    expect(namesFromTeamsSnapshot("[]")).toEqual([]);
  });
});

describe("namesFromPaymentsSnapshot", () => {
  it("extracts player names from payment entries", () => {
    const snapshot = JSON.stringify([
      { playerName: "Alice", amount: 5, status: "paid" },
      { playerName: "Bob", amount: 5, status: "pending" },
    ]);
    expect(namesFromPaymentsSnapshot(snapshot)).toEqual(["Alice", "Bob"]);
  });

  it("returns empty array for null or invalid JSON", () => {
    expect(namesFromPaymentsSnapshot(null)).toEqual([]);
    expect(namesFromPaymentsSnapshot("garbage")).toEqual([]);
    expect(namesFromPaymentsSnapshot("[]")).toEqual([]);
  });
});

describe("isNameInTeamsSnapshot", () => {
  it("matches case-insensitively", () => {
    expect(isNameInTeamsSnapshot(teams, "aLiCe")).toBe(true);
    expect(isNameInTeamsSnapshot(teams, "Bob")).toBe(true);
    expect(isNameInTeamsSnapshot(teams, "Dave")).toBe(false);
  });

  it("trims whitespace around the query name", () => {
    expect(isNameInTeamsSnapshot(teams, "  alice ")).toBe(true);
  });

  it("returns false for null snapshot or empty name", () => {
    expect(isNameInTeamsSnapshot(null, "Alice")).toBe(false);
    expect(isNameInTeamsSnapshot(teams, "  ")).toBe(false);
    expect(isNameInTeamsSnapshot(teams, null)).toBe(false);
  });
});

describe("isNameInPaymentsSnapshot", () => {
  it("matches case-insensitively against playerName", () => {
    const snapshot = JSON.stringify([{ playerName: "Bob", amount: 5, status: "pending" }]);
    expect(isNameInPaymentsSnapshot(snapshot, "bob")).toBe(true);
    expect(isNameInPaymentsSnapshot(snapshot, "Alice")).toBe(false);
  });

  it("returns false for null snapshot or empty name", () => {
    expect(isNameInPaymentsSnapshot(null, "Bob")).toBe(false);
    expect(isNameInPaymentsSnapshot(snapshotFor(""), "Bob")).toBe(false);
  });
});

function snapshotFor(name: string): string {
  return JSON.stringify([{ playerName: name, amount: 5, status: "pending" }]);
}

describe("isHistoryParticipant", () => {
  it("returns true when the name is in the history teamsSnapshot", () => {
    expect(isHistoryParticipant({ teamsSnapshot: teams }, "carol")).toBe(true);
  });

  it("returns false when the name is not in the history", () => {
    expect(isHistoryParticipant({ teamsSnapshot: teams }, "Dave")).toBe(false);
  });

  it("returns false for a history without a teamsSnapshot", () => {
    expect(isHistoryParticipant({ teamsSnapshot: null }, "Alice")).toBe(false);
    expect(isHistoryParticipant(null, "Alice")).toBe(false);
  });
});
