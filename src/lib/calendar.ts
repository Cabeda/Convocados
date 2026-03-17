/**
 * Generate .ics (iCalendar) content for an event.
 * RFC 5545 compliant.
 */

interface RecurrenceInfo {
  freq: "weekly" | "monthly";
  interval: number;
  byDay?: string; // "MO" | "TU" etc.
}

interface CalendarEvent {
  id: string;
  title: string;
  location: string;
  dateTime: Date;
  description?: string;
  url?: string;
  recurrence?: RecurrenceInfo | null;
}

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function buildRrule(r: RecurrenceInfo): string {
  const parts = [`FREQ=${r.freq.toUpperCase()}`, `INTERVAL=${r.interval}`];
  if (r.freq === "weekly" && r.byDay) {
    parts.push(`BYDAY=${r.byDay}`);
  }
  return parts.join(";");
}

export function generateIcs(event: CalendarEvent): string {
  const start = formatIcsDate(event.dateTime);
  // Default duration: 1.5 hours
  const end = formatIcsDate(new Date(event.dateTime.getTime() + 90 * 60 * 1000));
  const now = formatIcsDate(new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Convocados//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@convocados`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcs(event.title)}`,
  ];

  if (event.location) {
    lines.push(`LOCATION:${escapeIcs(event.location)}`);
  }
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
  }
  if (event.url) {
    lines.push(`URL:${event.url}`);
  }
  if (event.recurrence) {
    lines.push(`RRULE:${buildRrule(event.recurrence)}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n") + "\r\n";
}

/**
 * Build a Google Calendar "Add Event" URL.
 */
export function googleCalendarUrl(event: CalendarEvent): string {
  const start = formatIcsDate(event.dateTime);
  const end = formatIcsDate(new Date(event.dateTime.getTime() + 90 * 60 * 1000));

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${start}/${end}`,
  });

  if (event.location) params.set("location", event.location);
  if (event.url) params.set("details", `Join: ${event.url}`);
  if (event.recurrence) params.set("recur", `RRULE:${buildRrule(event.recurrence)}`);

  return `https://www.google.com/calendar/render?${params.toString()}`;
}
