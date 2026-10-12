/**
 * Nightshift ledger — the audit trail.
 *
 * Every decision the loop makes is appended here as one JSON line, so the
 * morning's question ("what did it actually do?") has an answer that is not the
 * model's own recollection. Written to a gitignored path by default; the worker
 * never commits it.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LEDGER = process.env.NIGHTSHIFT_LEDGER ?? ".nightshift/ledger.jsonl";

export interface LedgerEvent {
  /** Short machine name: `select`, `gate`, `pr-open`, `repair`, `merge`, ... */
  event: string;
  [key: string]: unknown;
}

export function record(event: LedgerEvent): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, `${line}\n`);
  process.stderr.write(`[nightshift] ${line}\n`);
}
