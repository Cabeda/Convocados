import { describe, it, expect } from "vitest";
import { generateIcs, googleCalendarUrl } from "../lib/calendar";

describe("generateIcs", () => {
  const event = {
    id: "test-123",
    title: "Tuesday 5-a-side",
    location: "Riverside Astro, Pitch 2",
    dateTime: new Date("2026-03-24T19:00:00Z"),
    url: "https://convocados.fly.dev/events/test-123",
    description: "Convocados game",
  };

  it("produces valid iCalendar output", () => {
    const ics = generateIcs(event);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("SUMMARY:Tuesday 5-a-side");
    expect(ics).toContain("LOCATION:Riverside Astro\\, Pitch 2");
    expect(ics).toContain("UID:test-123@convocados");
    expect(ics).toContain("URL:https://convocados.fly.dev/events/test-123");
  });

  it("uses 1.5 hour default duration", () => {
    const ics = generateIcs(event);
    // Start: 20260324T190000Z, End: 20260324T203000Z (1.5h later)
    expect(ics).toContain("DTSTART:20260324T190000Z");
    expect(ics).toContain("DTEND:20260324T203000Z");
  });

  it("omits location when empty", () => {
    const ics = generateIcs({ ...event, location: "" });
    expect(ics).not.toContain("LOCATION:");
  });

  it("escapes special characters", () => {
    const ics = generateIcs({ ...event, title: "Game; with, special\\chars\nnewline" });
    expect(ics).toContain("SUMMARY:Game\\; with\\, special\\\\chars\\nnewline");
  });
});

describe("googleCalendarUrl", () => {
  const event = {
    id: "test-123",
    title: "Tuesday 5-a-side",
    location: "Riverside Astro",
    dateTime: new Date("2026-03-24T19:00:00Z"),
    url: "https://convocados.fly.dev/events/test-123",
  };

  it("returns a Google Calendar URL", () => {
    const url = googleCalendarUrl(event);
    expect(url).toContain("https://www.google.com/calendar/render");
    expect(url).toContain("text=Tuesday+5-a-side");
    expect(url).toContain("location=Riverside+Astro");
    expect(url).toContain("20260324T190000Z");
  });

  it("includes event link in details", () => {
    const url = googleCalendarUrl(event);
    expect(url).toContain("details=");
    expect(url).toContain("convocados.fly.dev");
  });
});
