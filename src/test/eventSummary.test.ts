import { describe, it, expect } from "vitest";
import { buildEventSummary } from "../lib/eventSummary";

const base = {
  id: "evt-1",
  title: "Ninjas da Areosa",
  location: "Areosa",
  dateTime: new Date("2026-09-21T18:00:00Z"),
  sport: "football-5v5",
  maxPlayers: 10,
  playerCount: 8,
  playerNames: ["Alice", "Bob"],
  teams: [{ name: "Ninjas", members: ["Alice"] }],
  locked: false,
};

describe("buildEventSummary", () => {
  it("exposes the read-only facts an HTML-only client needs", () => {
    const s = buildEventSummary(base);
    expect(s.heading).toBe("Ninjas da Areosa");
    expect(s.meta).toContain("2026-09-21T18:00:00.000Z");
    expect(s.meta).toContain("Areosa");
    expect(s.meta).toContain("football-5v5");
    expect(s.attendance).toBe("8/10 players · 2 spot(s) left");
    expect(s.players).toBe("Alice, Bob");
    expect(s.teams).toEqual([{ name: "Ninjas", members: ["Alice"] }]);
    expect(s.apiPath).toBe("/api/events/evt-1");
  });

  it("falls back to TBD for a missing location", () => {
    expect(buildEventSummary({ ...base, location: "" }).meta).toContain("TBD");
  });

  it("caps spots left at 0 when over capacity", () => {
    expect(buildEventSummary({ ...base, playerCount: 15 }).attendance).toBe("15/10 players · 0 spot(s) left");
  });

  it("returns null players when the roster is empty", () => {
    expect(buildEventSummary({ ...base, playerCount: 0, playerNames: [] }).players).toBeNull();
  });

  it("withholds the roster when the event is password-locked", () => {
    const s = buildEventSummary({ ...base, locked: true });
    expect(s.players).toBeNull();
    expect(s.teams).toEqual([]);
    expect(s.attendance).toMatch(/password/i);
  });
});
