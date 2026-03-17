import { describe, it, expect } from "vitest";
import { generateEventJsonLd, generateEventMetaTags } from "../lib/seo";

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
