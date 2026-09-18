/**
 * Deterministic clock seam.
 *
 * Production and normal development use the real wall clock. Automated
 * screenshot capture freezes time by setting `CONVOCADOS_FIXED_NOW` to an
 * ISO-8601 instant, so server rendering and the browser render the same
 * relative dates and game phases. See docs/adr/0037-ci-owned-readme-screenshots.md.
 *
 * The override is read on every call (not cached at import) so tests and
 * short-lived scripts can toggle it without reloading modules.
 */
const FIXED_NOW_ENV = "CONVOCADOS_FIXED_NOW";

export function nowMs(): number {
  const raw = process.env[FIXED_NOW_ENV];
  if (raw) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export function now(): Date {
  return new Date(nowMs());
}
