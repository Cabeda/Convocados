/**
 * Nightshift planning — pure selection logic, no I/O.
 *
 * Given the open Issues and the open Changes, decide which Issues may be worked
 * and in what order. Kept pure and separate from `select.ts` so the queue rules
 * are testable without a network.
 */

export interface IssueFacts {
  number: number;
  title: string;
  createdAt: string;
  labels: string[];
}

export interface OpenPrHead {
  /** The head branch of an open PR, e.g. `factory/12-add-thing`. */
  headRefName: string;
}

/** Issues the loop must never pick up on its own. */
const PARKED_LABELS = ["factory:blocked", "factory:explored"];

/** Higher number = lower priority. Matches the factory queue in AGENTS.md. */
export function priorityOf(labels: string[]): number {
  for (const n of [1, 2, 3]) {
    if (labels.includes(`dex:priority-${n}`)) return n;
  }
  return 99;
}

/** The branch prefix a worker uses for an Issue. */
export function branchPrefixForIssue(issueNumber: number): string {
  return `factory/${issueNumber}-`;
}

/** True when an open PR already exists for this Issue. */
export function hasOpenPr(issueNumber: number, openHeads: OpenPrHead[]): boolean {
  const prefix = branchPrefixForIssue(issueNumber);
  return openHeads.some((h) => h.headRefName.startsWith(prefix));
}

/** An Issue is ready to work when it is offered and not parked. */
export function isWorkable(issue: IssueFacts, openHeads: OpenPrHead[]): boolean {
  if (!issue.labels.includes("ready-for-agent")) return false;
  if (PARKED_LABELS.some((l) => issue.labels.includes(l))) return false;
  if (hasOpenPr(issue.number, openHeads)) return false;
  return true;
}

/**
 * The work order: priority label first, then oldest Issue first within a
 * priority. Oldest is a stable proxy for "has waited longest".
 */
export function planOrder(issues: IssueFacts[], openHeads: OpenPrHead[]): number[] {
  return issues
    .filter((i) => isWorkable(i, openHeads))
    .sort((a, b) => {
      const p = priorityOf(a.labels) - priorityOf(b.labels);
      if (p !== 0) return p;
      return a.number - b.number;
    })
    .map((i) => i.number);
}

/** `factory/<n>-<slug>` from a title, e.g. "Add thing" → `factory/12-add-thing`. */
export function branchForIssue(issue: IssueFacts): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${branchPrefixForIssue(issue.number)}${slug || "work"}`;
}
