/**
 * The four positions a roster row can carry (#1448).
 *
 * A preference, not a constraint: the column is nullable, nothing enforces a
 * formation, and a sport where these labels mean nothing simply leaves them
 * empty. The values are stable identifiers, not display strings — the labels
 * come from i18n — so they are stored as-is and never translated.
 */
export const POSITIONS = ["GK", "DEF", "MID", "FWD"] as const;

export type Position = (typeof POSITIONS)[number];

export function isPosition(value: unknown): value is Position {
  return typeof value === "string" && (POSITIONS as readonly string[]).includes(value);
}

/**
 * Read a `position` field from a request body.
 *
 * Returns `undefined` for "not sent" (leave the stored value alone), `null` for
 * an explicit clear, and a `Position` for a valid value. An unknown string is a
 * client error, which the caller turns into a 400 — free text in this column
 * would make the rotation suggestion's input meaningless.
 */
export function readPosition(value: unknown): { ok: true; position: Position | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, position: undefined };
  if (value === null || value === "") return { ok: true, position: null };
  if (isPosition(value)) return { ok: true, position: value };
  return { ok: false };
}
