import { describe, it, expect } from "vitest";
import { generateIcsFeed } from "../lib/calendar";

describe("generateIcsFeed", () => {
  const events = [
    {
      id: "evt-1",
      title: "Tuesday 5-a-side",
      location: "Riverside Astro, Pitch 2",
      dateTime: new Date("2026-03-24T19:00:00Z"),
      url: "https://convocados.fly.dev/events/evt-1",
      description: "Convocados game — Tuesday 5-a-side",
    },
    {
      id: "evt-2",
      title: "Thursday Futsal",
      location: "Sports Hall",
      dateTime: new Date("2026-03-26T20:00:00Z"),
      url: "https://convocados.fly.dev/events/evt-2",
      description: "Convocados game — Thursday Futsal",
    },
  ];

  it("produces valid iCalendar with multiple VEVENTs", () => {
    const ics = generateIcsFeed(events, "My Games");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    // Two events
    const veventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
    expect(veventCount).toBe(2);
    expect(ics).toContain("UID:evt-1@convocados");
    expect(ics).toContain("UID:evt-2@convocados");
    expect(ics).toContain("SUMMARY:Tuesday 5-a-side");
    expect(ics).toContain("SUMMARY:Thursday Futsal");
  });

  it("includes feed name as X-WR-CALNAME", () => {
    const ics = generateIcsFeed(events, "My Games");
    expect(ics).toContain("X-WR-CALNAME:My Games");
  });

  it("handles empty event list", () => {
    const ics = generateIcsFeed([], "Empty Feed");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("includes RRULE for recurring events in feed", () => {
    const recurring = [
      {
        ...events[0],
        recurrence: { freq: "weekly" as const, interval: 1, byDay: "TU" },
      },
    ];
    const ics = generateIcsFeed(recurring, "Recurring");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU");
  });

  it("uses correct date format", () => {
    const ics = generateIcsFeed([events[0]], "Test");
    expect(ics).toContain("DTSTART:20260324T190000Z");
    expect(ics).toContain("DTEND:20260324T203000Z");
  });

  it("includes location and description", () => {
    const ics = generateIcsFeed([events[0]], "Test");
    expect(ics).toContain("LOCATION:Riverside Astro\\, Pitch 2");
    expect(ics).toContain("DESCRIPTION:Convocados game");
  });

  it("includes URL for each event", () => {
    const ics = generateIcsFeed(events, "Test");
    expect(ics).toContain("URL:https://convocados.fly.dev/events/evt-1");
    expect(ics).toContain("URL:https://convocados.fly.dev/events/evt-2");
  });

  it("omits optional fields when not provided", () => {
    const minimal = [{ id: "m-1", title: "Game", location: "", dateTime: new Date("2026-04-01T18:00:00Z") }];
    const ics = generateIcsFeed(minimal, "Minimal");
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("URL:");
    expect(ics).not.toContain("RRULE:");
  });
});
