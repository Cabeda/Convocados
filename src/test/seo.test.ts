import { describe, it, expect } from "vitest";
import { generateEventJsonLd, generateEventHead, generateEventMetaTags } from "../lib/seo";

describe("generateEventJsonLd", () => {
  const event = {
    id: "evt-1",
    title: "Tuesday 5-a-side",
    location: "Riverside Astro, Pitch 2",
    dateTime: new Date("2026-03-24T19:00:00Z"),
    sport: "football-5v5",
    maxPlayers: 10,
    playerCount: 6,
    url: "https://convocados.fly.dev/events/evt-1",
  };

  it("produces valid Schema.org SportsEvent JSON-LD", () => {
    const jsonLd = generateEventJsonLd(event);
    const parsed = JSON.parse(jsonLd);
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("SportsEvent");
    expect(parsed.name).toBe("Tuesday 5-a-side");
    expect(parsed.location.name).toBe("Riverside Astro, Pitch 2");
    expect(parsed.startDate).toBe("2026-03-24T19:00:00.000Z");
    expect(parsed.url).toBe("https://convocados.fly.dev/events/evt-1");
    expect(parsed.maximumAttendeeCapacity).toBe(10);
    expect(parsed.remainingAttendeeCapacity).toBe(4);
  });

  it("includes organizer as Convocados", () => {
    const parsed = JSON.parse(generateEventJsonLd(event));
    expect(parsed.organizer.name).toBe("Convocados");
  });

  it("sets eventStatus to EventScheduled", () => {
    const parsed = JSON.parse(generateEventJsonLd(event));
    expect(parsed.eventStatus).toBe("https://schema.org/EventScheduled");
  });

  it("uses TBD when location is empty", () => {
    const parsed = JSON.parse(generateEventJsonLd({ ...event, location: "" }));
    expect(parsed.location.name).toBe("TBD");
  });

  it("caps remainingAttendeeCapacity at 0", () => {
    const parsed = JSON.parse(generateEventJsonLd({ ...event, playerCount: 15 }));
    expect(parsed.remainingAttendeeCapacity).toBe(0);
  });
});

const baseEvent = {
  id: "evt-1",
  title: "Tuesday 5-a-side",
  location: "Riverside Astro, Pitch 2",
  dateTime: new Date("2026-03-24T19:00:00Z"),
  sport: "football-5v5",
  maxPlayers: 10,
  playerCount: 6,
  url: "https://convocados.fly.dev/events/evt-1",
};

describe("generateEventHead", () => {
  it("emits JSON-LD for a link-accessible event without a password", () => {
    const head = generateEventHead(baseEvent);
    expect(head.jsonLd).not.toBeNull();
    expect(JSON.parse(head.jsonLd!).name).toBe("Tuesday 5-a-side");
  });

  it("withholds JSON-LD when the event is password-locked", () => {
    const head = generateEventHead({ ...baseEvent, accessPassword: "$2b$10$hash" });
    expect(head.jsonLd).toBeNull();
  });

  it("always advertises the JSON representation of the same resource", () => {
    expect(generateEventHead(baseEvent).alternateJson).toBe("/api/events/evt-1");
    expect(generateEventHead({ ...baseEvent, accessPassword: "x" }).alternateJson).toBe(
      "/api/events/evt-1",
    );
  });
});

describe("generateEventMetaTags", () => {
  const event = {
    title: "Tuesday 5-a-side",
    description: "Join this game on Convocados",
    url: "https://convocados.fly.dev/events/evt-1",
    dateTime: new Date("2026-03-24T19:00:00Z"),
    location: "Riverside Astro",
    playerCount: 6,
    maxPlayers: 10,
  };

  it("generates og: meta tags", () => {
    const tags = generateEventMetaTags(event);
    expect(tags).toContainEqual({ property: "og:title", content: "Tuesday 5-a-side" });
    expect(tags).toContainEqual({ property: "og:type", content: "website" });
    expect(tags).toContainEqual({ property: "og:url", content: "https://convocados.fly.dev/events/evt-1" });
    expect(tags.find((t) => t.property === "og:description")?.content).toContain("Join this game");
  });

  it("generates twitter: meta tags", () => {
    const tags = generateEventMetaTags(event);
    expect(tags).toContainEqual({ property: "twitter:card", content: "summary" });
    expect(tags).toContainEqual({ property: "twitter:title", content: "Tuesday 5-a-side" });
  });
});
