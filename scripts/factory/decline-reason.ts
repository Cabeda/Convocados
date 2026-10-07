/**
 * Should the Factory decline this dispatch, and does anyone need telling?
 *
 * This exists because of a silent loss. On 2026-09-29 10:23:40Z an Issue was
 * labelled `ready-for-agent`; the run fired three seconds later and **skipped**,
 * because `FACTORY_APP_ID` was set 2.5 hours afterwards and `FACTORY_MODEL`
 * seven days afterwards. GitHub does not replay past events, so that offer was
 * never retried. The Issue sat labelled for a week looking like queued work,
 * and nothing anywhere said otherwise.
 *
 * Two failure modes to separate, because they need opposite treatment:
 *
 * - **Not an offer.** Most `issues: labeled` events are somebody tagging an
 *   Issue `dex:pending`. Declining those is correct and must stay quiet, or the
 *   Factory comments on the entire backlog every time somebody triages.
 * - **An offer we cannot honour.** The label was placed, the human reasonably
 *   expects work to start, and we are dropping it on the floor. That is a bug
 *   in our dispatch, and it must say so out loud.
 */

export type DispatchMode = "issues" | "workflow_dispatch";

export type DeclineReason =
  | "not-an-offer"
  | "paused"
  | "no-app-id"
  | "no-model";

export interface DispatchFacts {
  mode: DispatchMode;
  /** The label that fired a `issues` event; null for manual dispatch. */
  labelName: string | null;
  paused: boolean;
  appId: string;
  model: string;
}

export const READY_LABEL = "ready-for-agent";

/**
 * null means "proceed". Anything else means "do not start the agent", and the
 * caller decides whether to speak up about it.
 */
export function declineReason(f: DispatchFacts): DeclineReason | null {
  // A manual dispatch is an explicit human request and already carries the
  // Issue number; the agent re-checks the label itself.
  if (f.mode === "workflow_dispatch") return null;

  if (f.labelName !== READY_LABEL) return "not-an-offer";
  if (f.paused) return "paused";
  if (!f.appId.trim()) return "no-app-id";
  if (!f.model.trim()) return "no-model";
  return null;
}

/**
 * Only an offer we failed to honour earns a comment.
 *
 * `not-an-offer` is the overwhelming majority of label events and must stay
 * silent; commenting there would be noise on ordinary triage.
 */
export function shouldNotify(reason: DeclineReason | null): boolean {
  return reason !== null && reason !== "not-an-offer";
}

const REMEDY: Record<Exclude<DeclineReason, "not-an-offer">, string> = {
  paused:
    "`FACTORY_PAUSED` is set, so the Delivery Factory is stopped. Unset it, then re-apply " +
    "`ready-for-agent` to restart this one.",
  "no-app-id":
    "`FACTORY_APP_ID` is not set, so the factory has no identity to act as and cannot open a " +
    "Change. Run `pnpm setup-hooks` → the wizard, or set it from `.opencode/agents/factory.md`. " +
    "Then re-apply `ready-for-agent`.",
  "no-model":
    "`FACTORY_MODEL` is not set, so the factory has no model and cannot run. Set it, then " +
    "re-apply `ready-for-agent`.",
};

export function declineNotice(reason: DeclineReason, issueNumber: number): string {
  if (reason === "not-an-offer") {
    throw new Error("not-an-offer must not produce a notice; it is the silent path");
  }
  return [
    "**The Delivery Factory did not pick this up.**",
    "",
    `This Issue is labelled \`${READY_LABEL}\`, but the Factory declined the dispatch, so ` +
      "nothing is queued and no Change will open. That is a dispatch failure rather than a " +
      "decision about the work — the offer is still live.",
    "",
    REMEDY[reason],
    "",
    "GitHub does not replay past events, so re-applying the label is what restarts this. It " +
      "will not queue itself.",
    "",
    `<sub>Declined for: ${reason} · workflow ${issueNumber}</sub>`,
  ].join("\n");
}