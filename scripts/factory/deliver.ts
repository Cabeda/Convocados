/**
 * Deliver what the Factory agent produced, under a token minted now.
 *
 * An App token lives 60 minutes; the agent step may run 110. Minting it in the
 * agent's job (#937) meant every long run finished, died on `git push` with
 * `Bad credentials`, and still reported success. So the agent only commits and
 * writes `.factory-handoff/`; this runs later, with a fresh token.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Status = "review" | "blocked";

export interface Handoff {
  status: Status;
  branch: string | null;
  title: string;
}

/** `factory/<issue>-<slug>` only: the bundle carries history, so an unchecked
 *  name here could push onto main or a human branch. */
const DELIVERABLE_BRANCH = /^factory\/\d{1,6}-[a-z0-9][a-z0-9-]*$/;

export function isDeliverableBranch(branch: string | null | undefined): branch is string {
  return typeof branch === "string" && DELIVERABLE_BRANCH.test(branch);
}

/** Only an explicit `review` ships; a missing file is a run that never reached
 *  its handoff. */
export function parseStatus(raw: string | null | undefined): Status {
  return raw?.trim() === "review" ? "review" : "blocked";
}

export function titleFor(raw: string | null | undefined, issue: number): string {
  const title = raw?.trim();
  return title ? title : `factory: work Issue #${issue}`;
}

function read(dir: string, file: string): string | null {
  const full = path.join(dir, file);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

export function readHandoff(dir: string): Handoff {
  return {
    status: parseStatus(read(dir, "status")),
    branch: read(dir, "branch")?.trim() ?? null,
    title: read(dir, "title")?.trim() ?? "",
  };
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function main(): number {
  const repo = process.env.GITHUB_REPOSITORY ?? "Cabeda/Convocados";
  const issue = Number(process.env.ISSUE ?? "");
  const runUrl = process.env.RUN_URL ?? "";
  const dir = process.env.HANDOFF_DIR ?? ".factory-handoff";

  if (!Number.isInteger(issue) || issue <= 0) {
    console.error(`No Issue number to deliver for (ISSUE="${process.env.ISSUE ?? ""}").`);
    return 1;
  }

  const handoff = readHandoff(dir);
  const summary = read(dir, "comment.md")?.trim() ?? "";
  const bundle = path.join(dir, "change.bundle");
  const bodyFile = path.join(dir, "pr-body.md");
  const gh = (args: string[]) => run("gh", args);

  /** A terminal report the Issue can always receive, even when delivery fails. */
  const comment = (body: string) => {
    try {
      gh(["issue", "comment", String(issue), "--repo", repo, "--body", body]);
    } catch {
      // The run is already ending; a failed courtesy comment must not mask why.
    }
  };

  const blocked = (why: string): number => {
    comment([summary, why, runUrl ? `Run: ${runUrl}` : ""].filter(Boolean).join("\n\n"));
    try {
      gh(["issue", "edit", String(issue), "--repo", repo, "--add-label", "factory:blocked"]);
    } catch {
      console.error("Could not label the Issue factory:blocked.");
    }
    return 0;
  };

  if (handoff.status !== "review") {
    return blocked("**Blocked.** The run ended without a deliverable Change.");
  }
  if (!isDeliverableBranch(handoff.branch) || !existsSync(bundle) || !existsSync(bodyFile)) {
    return blocked("**Blocked.** The handoff was incomplete, so there is no Change to open.");
  }

  try {
    // `gh` holds the App token; this teaches git to borrow it without writing
    // the token into .git/config or onto a command line.
    gh(["auth", "setup-git"]);
    // The bundle records the local branch name, not HEAD.
    run("git", ["fetch", bundle, `+refs/heads/${handoff.branch}:refs/heads/${handoff.branch}`]);
    run("git", ["push", "origin", handoff.branch]);

    const existing = gh([
      "pr", "list", "--repo", repo, "--head", handoff.branch, "--state", "open",
      "--json", "number", "--jq", ".[0].number",
    ]).trim();

    const prUrl = existing
      ? gh(["pr", "view", existing, "--repo", repo, "--json", "url", "--jq", ".url"]).trim()
      : gh([
          "pr", "create", "--repo", repo, "--base", "main", "--head", handoff.branch,
          "--title", titleFor(handoff.title, issue), "--body-file", bodyFile,
        ]).trim();

    gh(["pr", "edit", prUrl, "--repo", repo, "--add-label", "factory:review"]);
    comment([summary, `Change: ${prUrl}`, runUrl ? `Run: ${runUrl}` : ""].filter(Boolean).join("\n\n"));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    comment([summary, `**Delivery failed.** ${message}`, runUrl ? `Run: ${runUrl}` : ""]
      .filter(Boolean)
      .join("\n\n"));
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
