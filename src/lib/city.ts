/**
 * The city an Event is discoverable by (#1445).
 *
 * `Event.location` is one free-text string, and a filter over parsed free text
 * is a broken filter ("Lisboa" vs "lisbon" vs "Lisboa, PT" fragment it). So the
 * city is guessed once, on the event form, and stored in its own column.
 *
 * It is stored *normalised* — trimmed, one space between words, each word
 * capitalised — so that an exact match is also a case-insensitive one. SQLite
 * compares TEXT with `=` case-sensitively, and Prisma has no `mode:
 * "insensitive"` on SQLite, so the normalisation is what makes "lisboa" find
 * "Lisboa" without a second column or a raw query.
 */
const SMALL_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "del", "la", "y", "di", "le"]);

/** Trim, collapse inner whitespace, and capitalise each word ("évora" -> "Évora"). */
export function normalizeCity(value: string): string {
  const words = String(value ?? "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return words
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toLocaleUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * The city guessed from a free-text location: "Campo Maior, Lisboa" -> "Lisboa".
 *
 * The last comma-separated segment is the city in every shape the location field
 * produces, with an optional leading postcode to strip. The organizer overrides
 * the guess in one tap, so a wrong guess costs a tap, not a broken record.
 *
 * shortcut: a location that ends with the country ("…, Lisboa, Portugal") guesses
 * the country; the override is the fix, and the field is pre-filled rather than
 * authoritative. Upgrade to a country/segment list if guesses prove wrong often.
 */
export function inferCity(location: string): string {
  const segments = String(location ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const last = segments.at(-1) ?? "";
  return normalizeCity(last.replace(/^\d{4,5}(-\d{3})?\s+/, ""));
}
