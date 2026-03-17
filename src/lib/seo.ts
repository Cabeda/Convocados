/**
 * SEO utilities: Schema.org JSON-LD, Open Graph, and Twitter Card meta tags.
 */

interface EventJsonLdInput {
  id: string;
  title: string;
  location: string;
  dateTime: Date;
  sport: string;
  maxPlayers: number;
  playerCount: number;
  url: string;
}

/** Generate Schema.org SportsEvent JSON-LD string */
export function generateEventJsonLd(event: EventJsonLdInput): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: event.title,
    startDate: event.dateTime.toISOString(),
    endDate: new Date(event.dateTime.getTime() + 90 * 60 * 1000).toISOString(),
    location: {
      "@type": "Place",
      name: event.location || "TBD",
    },
    url: event.url,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    maximumAttendeeCapacity: event.maxPlayers,
    remainingAttendeeCapacity: Math.max(0, event.maxPlayers - event.playerCount),
    organizer: {
      "@type": "Organization",
      name: "Convocados",
      url: "https://convocados.fly.dev",
    },
  });
}

interface MetaTagInput {
  title: string;
  description: string;
  url: string;
  dateTime?: Date;
  location?: string;
  playerCount?: number;
  maxPlayers?: number;
}

interface MetaTag {
  property: string;
  content: string;
}

/** Generate Open Graph + Twitter Card meta tags */
export function generateEventMetaTags(event: MetaTagInput): MetaTag[] {
  return [
    { property: "og:title", content: event.title },
    { property: "og:description", content: event.description },
    { property: "og:url", content: event.url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Convocados" },
    { property: "twitter:card", content: "summary" },
    { property: "twitter:title", content: event.title },
    { property: "twitter:description", content: event.description },
  ];
}
