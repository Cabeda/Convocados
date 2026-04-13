/**
 * Returns a curated list of IANA timezone identifiers with display labels.
 * Used in timezone pickers across the app.
 */
export const COMMON_TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Lisbon", label: "Lisbon (WET/WEST)" },
  { value: "Europe/Madrid", label: "Madrid (CET/CEST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
  { value: "Europe/Rome", label: "Rome (CET/CEST)" },
  { value: "Europe/Amsterdam", label: "Amsterdam (CET/CEST)" },
  { value: "Europe/Brussels", label: "Brussels (CET/CEST)" },
  { value: "Europe/Warsaw", label: "Warsaw (CET/CEST)" },
  { value: "Europe/Stockholm", label: "Stockholm (CET/CEST)" },
  { value: "Europe/Helsinki", label: "Helsinki (EET/EEST)" },
  { value: "Europe/Athens", label: "Athens (EET/EEST)" },
  { value: "Europe/Bucharest", label: "Bucharest (EET/EEST)" },
  { value: "Europe/Istanbul", label: "Istanbul (TRT)" },
  { value: "Europe/Moscow", label: "Moscow (MSK)" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "America/Chicago", label: "Chicago (CT)" },
  { value: "America/Denver", label: "Denver (MT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { value: "America/Sao_Paulo", label: "São Paulo (BRT)" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (ART)" },
  { value: "America/Mexico_City", label: "Mexico City (CST/CDT)" },
  { value: "America/Toronto", label: "Toronto (ET)" },
  { value: "America/Vancouver", label: "Vancouver (PT)" },
  { value: "Africa/Johannesburg", label: "Johannesburg (SAST)" },
  { value: "Africa/Lagos", label: "Lagos (WAT)" },
  { value: "Africa/Cairo", label: "Cairo (EET)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Shanghai (CST)" },
  { value: "Asia/Seoul", label: "Seoul (KST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
  { value: "Australia/Melbourne", label: "Melbourne (AEST/AEDT)" },
  { value: "Pacific/Auckland", label: "Auckland (NZST/NZDT)" },
] as const;

export type TimezoneValue = (typeof COMMON_TIMEZONES)[number]["value"];

/** Detect the user's local IANA timezone, falling back to UTC */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Format a Date in a specific IANA timezone using toLocaleString.
 * Passes `timeZone` into the Intl options so the formatted output reflects
 * the event's timezone rather than the browser's local timezone.
 */
export function formatDateInTz(
  date: Date,
  locale: string,
  timezone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return date.toLocaleString(locale, { ...options, timeZone: timezone || "UTC" });
}

/**
 * Convert a UTC Date to a `datetime-local` input value (YYYY-MM-DDTHH:mm)
 * in the given IANA timezone.
 *
 * We use Intl.DateTimeFormat to extract the date/time parts in the target
 * timezone, then assemble them into the format expected by `<input type="datetime-local">`.
 */
export function toDateTimeLocalValue(date: Date, timezone: string): string {
  const tz = timezone || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  // en-CA gives YYYY-MM-DD ordering; hour may be "24" at midnight in some engines
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/**
 * Convert a `datetime-local` input value (YYYY-MM-DDTHH:mm) in a given IANA
 * timezone back to a UTC ISO string suitable for the API.
 *
 * Uses a binary-search approach on the UTC offset: we create a candidate UTC
 * Date, format it in the target timezone, and adjust until the formatted
 * local time matches the desired input.
 */
export function fromDateTimeLocalValue(localValue: string, timezone: string): string {
  const tz = timezone || "UTC";

  // Parse the local value components
  const [datePart, timePart] = localValue.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  // Start with a naive UTC guess: treat the local value as if it were UTC
  const naiveUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Format that guess in the target timezone to find the offset
  const formatted = toDateTimeLocalValue(naiveUtc, tz);
  const [fDatePart, fTimePart] = formatted.split("T");
  const [fYear, fMonth, fDay] = fDatePart.split("-").map(Number);
  const [fHour, fMinute] = fTimePart.split(":").map(Number);

  // Compute the difference between what we got and what we wanted
  const got = new Date(Date.UTC(fYear, fMonth - 1, fDay, fHour, fMinute, 0, 0));
  const wanted = naiveUtc;
  const offsetMs = got.getTime() - wanted.getTime();

  // Adjust: if formatting added +1h (timezone is UTC+1), subtract that offset
  const corrected = new Date(naiveUtc.getTime() - offsetMs);

  // Verify the correction is accurate (handles DST edge cases)
  const verify = toDateTimeLocalValue(corrected, tz);
  if (verify !== localValue) {
    // DST boundary edge case — try ±1h adjustments
    for (const delta of [-3600000, 3600000]) {
      const attempt = new Date(corrected.getTime() + delta);
      if (toDateTimeLocalValue(attempt, tz) === localValue) {
        return attempt.toISOString();
      }
    }
  }

  return corrected.toISOString();
}
