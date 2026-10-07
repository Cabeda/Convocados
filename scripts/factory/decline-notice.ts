/**
 * Speak up when a live `ready-for-agent` offer cannot be honoured.
 *
 * Runs on every `issues: labeled` event, so it must be quiet almost always:
 * ordinary triage labels things `dex:pending` all day, and a Factory that
 * comments on the whole backlog every thirty minutes trains a human to ignore
 * it. `declineNotice()` throws rather than produce text for that path.
 *
 * Exits 0 always. This is a notice, not a gate — a failing run here would
 * redden a Change's check list for telling the truth.
 */
import { execFileSync } from "node:child_process";
import {
  declineNotice,
  declineReason,
  shouldNotify,
  type DispatchFacts,
  type DispatchMode,
} from "./decline-reason.ts";

const facts: DispatchFacts = {
  mode: (process.env.EVENT_NAME ?? "issues") as DispatchMode,
  labelName: process.env.EVENT_LABEL || null,
  paused: process.env.FACTORY_PAUSED === "true",
  appId: process.env.FACTORY_APP_ID ?? "",
  model: process.env.FACTORY_MODEL ?? "",
};

const reason = declineReason(facts);

if (reason === null) {
  console.log("Dispatch accepted — the Factory job will run.");
} else if (!shouldNotify(reason)) {
  // The overwhelming majority of events. Stay silent, by design.
  console.log(`Not an offer (${reason}) — staying quiet.`);
} else if (process.env.DRY_RUN === "true") {
  // Print the notice instead of posting it.
  //
  // Without this, exercising the notify path locally posts a real comment on a
  // real Issue under whatever identity `gh` happens to hold. `gh` falls back to
  // a stored token when the env var is empty, so "no token" is not a safe dry
  // run — the explicit flag is the only safe one.
  console.log(declineNotice(reason, Number(process.env.ISSUE_NUMBER ?? "")));
  console.log("DRY RUN — nothing posted.");
} else {
  const issue = process.env.ISSUE_NUMBER ?? "";
  const body = declineNotice(reason, Number(issue));
  try {
    execFileSync("gh", ["issue", "comment", issue, "--body", body], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`Declined for "${reason}" and said so on #${issue}.`);
  } catch {
    // Never fail the run for a failed courtesy notice.
    console.error(`Could not comment on #${issue} (declined for "${reason}").`);
  }
}