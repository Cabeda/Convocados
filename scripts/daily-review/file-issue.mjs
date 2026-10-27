#!/usr/bin/env node
/**
 * Validate a daily-review finding and turn it into a GitHub issue.
 *
 * The model proposes; this script decides. It enforces the issue contract
 * (evidence, acceptance, trade-offs, fingerprint), the daily caps, and dedupe
 * against open and recently closed issues. It is the only path to
 * `gh issue create` available to the orchestrator.
 *
 * Usage:
 *   node scripts/daily-review/file-issue.mjs [--date YYYY-MM-DD] [--dry-run]
 *        [--comment-on-duplicate] [--force]
 *   (JSON on stdin: {"findings":[...]} or a single finding)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const ROLES = ["ux", "architecture", "qa", "security", "sre", "product"];
export const ROLE_TITLES = {
  ux: "UX",
  architecture: "Architecture",
  qa: "QA",
  security: "Security",
  sre: "SRE",
  product: "Product",
};
export const PILLARS = ["simple-to-run", "fun-and-engaging", "management-free"];
export const PILLAR_TITLES = {
  "simple-to-run": "Simple to run",
  "fun-and-engaging": "Fun and engaging",
  "management-free": "Management-free",
};
const SEVERITIES = ["P0", "P1", "P2"];
const CONFIDENCES = ["high", "medium"];
const COSTS = ["S", "M", "L"];
const FINGERPRINT = /^[a-z][a-z-]*:[A-Za-z0-9_./@-]+:[A-Za-z0-9_.@-]+$/;
const FILE_PATH = /^[\w./@-]+$/;

function isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function inRange(value, min, max) {
  return isString(value) && value.trim().length >= min && value.trim().length <= max;
}

function stringList(value, min, max, minLen, maxLen, label, errors) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    errors.push(`${label} must have ${min}-${max} entries`);
    return;
  }
  value.forEach((entry, index) => {
    if (!inRange(entry, minLen, maxLen)) {
      errors.push(`${label}[${index}] must be ${minLen}-${maxLen} characters`);
    }
  });
}

/**
 * @param {unknown} finding
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateFinding(finding) {
  const errors = [];
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return { ok: false, errors: ["finding must be an object"] };
  }
  const f = /** @type {Record<string, unknown>} */ (finding);

  if (!ROLES.includes(f.role)) errors.push(`role must be one of ${ROLES.join(", ")}`);
  if (!SEVERITIES.includes(f.severity)) errors.push(`severity must be one of ${SEVERITIES.join(", ")}`);
  if (!CONFIDENCES.includes(f.confidence)) errors.push(`confidence must be high or medium`);
  if (!COSTS.includes(f.cost)) errors.push(`cost must be one of ${COSTS.join(", ")}`);
  if (!PILLARS.includes(f.pillar)) errors.push(`pillar must be one of ${PILLARS.join(", ")}`);
  if (string_has_newline(f.title)) errors.push("title must be one line");
  if (typeof f.title === "string" && f.title.trim().endsWith(".")) errors.push("title must not end with a period");
  if (!inRange(f.title, 10, 90)) errors.push("title must be 10-90 characters");
  if (!inRange(f.summary, 40, 600)) errors.push("summary must be 40-600 characters");
  if (!inRange(f.whyNow, 20, 400)) errors.push("whyNow must be 20-400 characters");
  if (!inRange(f.tradeoffs, 20, 600)) errors.push("tradeoffs must be 20-600 characters");
  if (!inRange(f.blastRadius, 10, 400)) errors.push("blastRadius must be 10-400 characters");
  stringList(f.evidence, 1, 5, 10, 400, "evidence", errors);
  stringList(f.acceptance, 1, 4, 10, 300, "acceptance", errors);

  if (!Array.isArray(f.files) || f.files.length < 1 || f.files.length > 8) {
    errors.push("files must have 1-8 entries");
  } else {
    f.files.forEach((file, index) => {
      if (!isString(file) || !FILE_PATH.test(file)) errors.push(`files[${index}] is not a repo-relative path`);
    });
  }

  if (!isString(f.fingerprint) || !FINGERPRINT.test(f.fingerprint)) {
    errors.push("fingerprint must look like role:path:symbol");
  } else if (typeof f.role === "string" && !f.fingerprint.startsWith(`${f.role}:`)) {
    errors.push("fingerprint must start with the role");
  }

  if (f.severity !== "P0" && f.cost === "L") {
    errors.push("a non-P0 finding may not cost L; split it or drop it");
  }

  if (f.role === "ux" || f.role === "qa" || f.role === "security") {
    stringList(f.repro, 1, 5, 10, 300, "repro", errors);
  }
  if (f.role === "sre") {
    stringList(f.measurement, 1, 4, 5, 300, "measurement", errors);
  }
  if (f.role === "product") {
    stringList(f.research, 2, 5, 10, 400, "research", errors);
    stringList(f.prototype, 1, 4, 10, 500, "prototype", errors);
  }

  return { ok: errors.length === 0, errors };
}

function string_has_newline(value) {
  return typeof value === "string" && /[\r\n]/.test(value);
}

/** @param {Record<string, any>} f */
export function titleFor(f) {
  return `[${ROLE_TITLES[f.role]}] ${f.title.trim()}`;
}

/** @param {Record<string, any>} f */
export function renderIssueBody(f) {
  const sections = [
    `<!-- daily-review fingerprint: ${f.fingerprint} -->`,
    `> Filed by the daily senior review (**${ROLE_TITLES[f.role]}**). Not queued: only Cabeda applies \`ready-for-agent\`.`,
    "",
    `**Pillar:** ${PILLAR_TITLES[f.pillar]} · **Severity:** ${f.severity} · **Confidence:** ${f.confidence} · **Cost:** ${f.cost}`,
    "",
    "## What",
    "",
    f.summary.trim(),
    "",
    "## Why now",
    "",
    f.whyNow.trim(),
    "",
    "## Evidence",
    "",
    ...f.evidence.map((entry) => `- ${entry.trim()}`),
  ];

  if (Array.isArray(f.repro) && f.repro.length > 0) {
    sections.push("", "## Reproduction", "", ...f.repro.map((step, index) => `${index + 1}. ${step.trim()}`));
  }

  if (Array.isArray(f.research) && f.research.length > 0) {
    sections.push("", "## Research", "", ...f.research.map((entry) => `- ${entry.trim()}`));
  }

  if (Array.isArray(f.prototype) && f.prototype.length > 0) {
    sections.push("", "## Prototype", "", ...f.prototype.map((entry) => `- ${entry.trim()}`));
  }

  if (Array.isArray(f.measurement) && f.measurement.length > 0) {
    sections.push("", "## Measurement", "", ...f.measurement.map((entry) => `- ${entry.trim()}`));
  }

  sections.push(
    "",
    "## Acceptance criterion",
    "",
    ...f.acceptance.map((entry) => `- [ ] ${entry.trim()}`),
    "",
    "## Trade-offs",
    "",
    f.tradeoffs.trim(),
    "",
    "## Blast radius",
    "",
    f.blastRadius.trim(),
    "",
    `**Files:** ${f.files.map((file) => `\`${file}\``).join(", ")}`,
    "",
    `<sub>Fingerprint: \`${f.fingerprint}\`. Filed by \`scripts/daily-review/file-issue.mjs\`.</sub>`,
  );

  return `${sections.join("\n")}\n`;
}

/** @param {string} date */
export function stateFile(date, stateDir = process.env.XDG_STATE_HOME
  ? path.join(process.env.XDG_STATE_HOME, "convocados/daily-review")
  : path.join(homedir(), ".local/state/convocados/daily-review")) {
  return path.join(stateDir, `${date}.json`);
}

/** @param {string} file */
export function readState(file) {
  if (!existsSync(file)) return { filed: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { filed: Array.isArray(parsed.filed) ? parsed.filed : [] };
  } catch {
    return { filed: [] };
  }
}

/** @param {string} file @param {{filed: Array<Record<string, any>>}} state */
export function writeState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * @param {string} fingerprint
 * @param {(command: string, args: string[]) => string} run
 */
export function findDuplicate(fingerprint, run) {
  const output = run("gh", [
    "issue",
    "list",
    "--state",
    "all",
    "--search",
    `"${fingerprint}" in:body`,
    "--json",
    "number,state,title,url,body",
    "--limit",
    "20",
  ]);
  const issues = JSON.parse(output || "[]");
  return issues.find((issue) => typeof issue.body === "string" && issue.body.includes(fingerprint)) ?? null;
}

/**
 * @param {Record<string, any>} finding
 * @param {{
 *   run: (command: string, args: string[]) => string,
 *   date: string,
 *   state?: {filed: Array<Record<string, any>>},
 *   maxIssues?: number,
 *   maxPerRole?: number,
 *   commentOnDuplicate?: boolean,
 *   force?: boolean,
 *   dryRun?: boolean,
 * }} options
 */
export function fileFinding(finding, options) {
  const {
    run,
    date,
    state = { filed: [] },
    maxIssues = Number(process.env.DAILY_REVIEW_MAX_ISSUES ?? 6),
    maxPerRole = Number(process.env.DAILY_REVIEW_MAX_PER_ROLE ?? 2),
    commentOnDuplicate = false,
    force = false,
    dryRun = false,
  } = options;

  const validation = validateFinding(finding);
  if (!validation.ok) return { status: "invalid", errors: validation.errors };

  const fingerprint = finding.fingerprint;
  const duplicate = findDuplicate(fingerprint, run);
  if (duplicate) {
    if (duplicate.state === "CLOSED" && !force) {
      return { status: "duplicate-closed", issue: { number: duplicate.number, url: duplicate.url } };
    }
    if (duplicate.state === "OPEN" && commentOnDuplicate) {
      const hasEvidence = (finding.evidence ?? []).every((entry) => duplicate.body.includes(entry));
      if (!hasEvidence) {
        const body = [
          `**Daily review (${ROLE_TITLES[finding.role]}) — ${date}**`,
          "",
          "Additional evidence for this issue:",
          "",
          ...finding.evidence.map((entry) => `- ${entry}`),
          "",
          `Fingerprint: \`${fingerprint}\``,
        ].join("\n");
        if (!dryRun) run("gh", ["issue", "comment", String(duplicate.number), "--body", body]);
        return {
          status: "commented",
          issue: { number: duplicate.number, url: duplicate.url },
        };
      }
    }
    return { status: "duplicate", issue: { number: duplicate.number, url: duplicate.url } };
  }

  const roleCount = state.filed.filter((entry) => entry.role === finding.role).length;
  if (state.filed.length >= maxIssues) {
    return { status: "capped", reason: `daily cap of ${maxIssues} issues reached` };
  }
  if (roleCount >= maxPerRole) {
    return { status: "capped", reason: `role cap of ${maxPerRole} issues for ${finding.role} reached` };
  }

  const title = titleFor(finding);
  const body = renderIssueBody(finding);
  if (dryRun) return { status: "would-file", title, fingerprint };

  const output = run("gh", [
    "issue",
    "create",
    "--title",
    title,
    "--body",
    body,
    "--label",
    "factory:explored",
  ]);
  const url = output.trim().split(/\s+/).find((part) => part.startsWith("http")) ?? output.trim();
  const numberMatch = url.match(/\/issues\/(\d+)/);
  const number = numberMatch ? Number(numberMatch[1]) : null;
  return { status: "filed", issue: { number, url, title } };
}

/**
 * @param {unknown} payload
 * @returns {Array<Record<string, any>>}
 */
export function findingsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(/** @type {any} */ (payload).findings)) {
    return /** @type {any} */ (payload).findings;
  }
  if (payload && typeof payload === "object") return [/** @type {any} */ (payload)];
  return [];
}

function defaultRun(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function main(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const dateIndex = argv.indexOf("--date");
  const date = dateIndex >= 0 ? argv[dateIndex + 1] : today();
  const dryRun = flags.has("--dry-run");

  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    console.error(JSON.stringify({ error: `invalid JSON on stdin: ${String(error)}` }));
    return 2;
  }

  const findings = findingsFromPayload(payload);
  if (findings.length === 0) {
    console.log(JSON.stringify({ date, results: [], note: "no findings supplied" }, null, 2));
    return 0;
  }

  const file = stateFile(date);
  const state = readState(file);
  const results = [];
  let invalid = false;
  let failed = false;

  for (const finding of findings) {
    try {
      const result = fileFinding(finding, {
        run: defaultRun,
        date,
        state,
        commentOnDuplicate: flags.has("--comment-on-duplicate"),
        force: flags.has("--force"),
        dryRun,
      });
      results.push({ role: finding?.role, fingerprint: finding?.fingerprint, ...result });
      if (result.status === "filed" && result.issue?.number) {
        state.filed.push({
          role: finding.role,
          number: result.issue.number,
          url: result.issue.url,
          fingerprint: finding.fingerprint,
        });
      }
      if (result.status === "invalid") invalid = true;
      if (result.status === "error") failed = true;
    } catch (error) {
      failed = true;
      results.push({
        role: finding?.role,
        fingerprint: finding?.fingerprint,
        status: "error",
        reason: String(error?.message ?? error),
      });
    }
  }

  if (!dryRun) writeState(file, state);
  console.log(JSON.stringify({ date, results, state: file }, null, 2));
  if (invalid) return 2;
  if (failed) return 1;
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
