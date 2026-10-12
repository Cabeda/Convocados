/**
 * Nightshift coverage helpers — pure parsing, so the coverage ratchet
 * (Core Principle 5: thresholds only move up) is enforced by code, not memory.
 */

export interface Thresholds {
  lines?: number;
  statements?: number;
  functions?: number;
  branches?: number;
}

const KEYS: Array<keyof Thresholds> = ["lines", "statements", "functions", "branches"];

/** Pull the four coverage thresholds out of a vitest config's text. */
export function parseThresholds(source: string): Thresholds {
  const thresholds: Thresholds = {};
  for (const key of KEYS) {
    const m = source.match(new RegExp(`\\b${key}\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
    if (m) thresholds[key] = Number.parseFloat(m[1]);
  }
  return thresholds;
}

/**
 * True when any threshold present in both moved down. A threshold that exists on
 * the branch but not the base is a raise, not a drop; a threshold dropped
 * entirely is invisible here and is caught by review, not by a number.
 */
export function thresholdsLowered(base: Thresholds, head: Thresholds): boolean {
  return KEYS.some((k) => {
    const b = base[k];
    const h = head[k];
    return b !== undefined && h !== undefined && h < b;
  });
}

/**
 * The overall coverage percentage from a vitest text coverage report.
 *
 * The report's `All files` row carries four figures; the first is line coverage.
 * Returns null when the row is absent, so the caller can fail closed.
 */
export function parseCoverageSummary(report: string): number | null {
  const line = report.split("\n").find((l) => /^All files\b/.test(l.trim()) || /^\s*All files\b/.test(l));
  if (!line) return null;
  const pct = line.match(/(\d+(?:\.\d+)?)/);
  return pct ? Number.parseFloat(pct[1]) : null;
}
