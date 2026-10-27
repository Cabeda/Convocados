import { describe, it, expect, vi } from "vitest";
import {
  fileFinding,
  findDuplicate,
  renderIssueBody,
  titleFor,
  validateFinding,
} from "../../scripts/daily-review/file-issue.mjs";
import {
  pickCategory,
  pickDiscussion,
  postDigest,
  renderDigestBody,
} from "../../scripts/daily-review/digest.mjs";

const validFinding = {
  role: "qa",
  severity: "P1",
  confidence: "high",
  cost: "S",
  pillar: "simple-to-run",
  title: "Cover the last-spot race when two players accept together",
  summary:
    "Two players can accept the last roster spot at the same time and both are written as active, while the loser never sees a full-game message.",
  whyNow:
    "The join path changed in the last release and the race is now reachable from the RSVP button on a slow connection.",
  evidence: [
    "src/lib/applyRosterChange.server.ts:120 — the capacity check and the insert are separate statements",
    "pnpm vitest run src/test/rejoin-after-leave.test.ts — no concurrent-accept case exists",
  ],
  repro: ["Open a game with 9 of 10 spots", "Accept from two tabs at the same time"],
  acceptance: [
    "A concurrent accept leaves exactly one active player and the loser gets a 409 with a full-game message",
  ],
  tradeoffs:
    "A transaction adds a write lock to a hot path; the alternative is to keep a race that silently overfills a game.",
  blastRadius: "Roster, waitlist and payments; a wrong lock can block joins under load.",
  files: ["src/lib/applyRosterChange.server.ts"],
  fingerprint: "qa:src/lib/applyRosterChange.server.ts:last-spot-race",
};

function fakeRun(overrides: Record<string, string> = {}) {
  const calls: Array<[string, string[]]> = [];
  const run = vi.fn((command: string, args: string[]) => {
    calls.push([command, args]);
    const key = `${command} ${args.slice(0, 2).join(" ")}`;
    if (overrides[key] !== undefined) return overrides[key];
    if (args[0] === "issue" && args[1] === "list") return "[]";
    if (args[0] === "issue" && args[1] === "create") {
      return "https://github.com/Cabeda/Convocados/issues/77\n";
    }
    return "";
  });
  return { run, calls };
}

describe("daily-review finding validation", () => {
  it("accepts the documented shape", () => {
    expect(validateFinding(validFinding)).toEqual({ ok: true, errors: [] });
  });

  it("rejects a finding with no evidence", () => {
    const { evidence: _evidence, ...finding } = validFinding;
    expect(validateFinding(finding).errors).toContain("evidence must have 1-5 entries");
  });

  it("rejects a low-confidence finding", () => {
    expect(validateFinding({ ...validFinding, confidence: "low" }).errors).toContain(
      "confidence must be high or medium",
    );
  });

  it("rejects a large non-P0 cost", () => {
    expect(validateFinding({ ...validFinding, cost: "L" }).errors).toContain(
      "a non-P0 finding may not cost L; split it or drop it",
    );
    expect(validateFinding({ ...validFinding, cost: "L", severity: "P0" }).ok).toBe(true);
  });

  it("requires a reproduction for ux, qa and security", () => {
    const { repro: _repro, ...finding } = validFinding;
    expect(validateFinding(finding).errors).toContain("repro must have 1-5 entries");
  });

  it("requires research and a prototype for product", () => {
    const product = {
      ...validFinding,
      role: "product",
      fingerprint: "product:src/lib/eventSummary.ts:returning-player-nudge",
    };
    const errors = validateFinding(product).errors;
    expect(errors).toContain("research must have 2-5 entries");
    expect(errors).toContain("prototype must have 1-4 entries");
  });

  it("requires a measurement for sre", () => {
    const sre = { ...validFinding, role: "sre", fingerprint: "sre:fly.toml:machine-size" };
    expect(validateFinding(sre).errors).toContain("measurement must have 1-4 entries");
  });
});

describe("daily-review issue rendering", () => {
  it("prefixes the title with the role", () => {
    expect(titleFor(validFinding)).toBe(`[QA] ${validFinding.title}`);
  });

  it("carries the fingerprint, evidence and acceptance criterion", () => {
    const body = renderIssueBody(validFinding);
    expect(body).toContain(`<!-- daily-review fingerprint: ${validFinding.fingerprint} -->`);
    expect(body).toContain("**Pillar:** Simple to run");
    expect(body).toContain("- [ ] A concurrent accept leaves exactly one active player");
    expect(body).toContain("## Trade-offs");
  });
});

describe("daily-review dedupe", () => {
  it("finds an issue whose body carries the fingerprint", () => {
    const duplicate = {
      number: 9,
      state: "OPEN",
      title: "[QA] existing",
      url: "https://github.com/Cabeda/Convocados/issues/9",
      body: `<!-- daily-review fingerprint: ${validFinding.fingerprint} -->`,
    };
    const { run } = fakeRun({ 'gh issue list': JSON.stringify([duplicate]) });
    expect(findDuplicate(validFinding.fingerprint, run)).toEqual(duplicate);
  });
});

describe("daily-review filing", () => {
  it("files with factory:explored and never ready-for-agent", () => {
    const { run, calls } = fakeRun();
    const result = fileFinding(validFinding, {
      run,
      date: "2026-10-26",
      state: { filed: [] },
    });

    expect(result.status).toBe("filed");
    const create = calls.find(([, args]) => args[0] === "issue" && args[1] === "create");
    expect(create).toBeTruthy();
    const args = create![1];
    expect(args).toContain("[QA] Cover the last-spot race when two players accept together");
    expect(args[args.indexOf("--label") + 1]).toBe("factory:explored");
    expect(args.join(" ")).not.toContain("--label ready-for-agent");
  });

  it("does not file a duplicate", () => {
    const duplicate = {
      number: 9,
      state: "OPEN",
      title: "[QA] existing",
      url: "https://github.com/Cabeda/Convocados/issues/9",
      body: `<!-- daily-review fingerprint: ${validFinding.fingerprint} -->`,
    };
    const { run } = fakeRun({ 'gh issue list': JSON.stringify([duplicate]) });
    const result = fileFinding(validFinding, { run, date: "2026-10-26", state: { filed: [] } });
    expect(result.status).toBe("duplicate");
  });

  it("does not refile a closed duplicate", () => {
    const duplicate = {
      number: 9,
      state: "CLOSED",
      title: "[QA] fixed",
      url: "https://github.com/Cabeda/Convocados/issues/9",
      body: `<!-- daily-review fingerprint: ${validFinding.fingerprint} -->`,
    };
    const { run } = fakeRun({ 'gh issue list': JSON.stringify([duplicate]) });
    const result = fileFinding(validFinding, { run, date: "2026-10-26", state: { filed: [] } });
    expect(result.status).toBe("duplicate-closed");
  });

  it("enforces the daily cap", () => {
    const { run, calls } = fakeRun();
    const filed = Array.from({ length: 6 }, (_, index) => ({
      role: "ux",
      number: index + 1,
      fingerprint: `ux:src/pages/${index}.ts:thing`,
    }));
    const result = fileFinding(validFinding, { run, date: "2026-10-26", state: { filed } });
    expect(result.status).toBe("capped");
    expect(calls.some(([, args]) => args[0] === "issue" && args[1] === "create")).toBe(false);
  });

  it("enforces the per-role cap", () => {
    const { run } = fakeRun();
    const filed = [
      { role: "qa", number: 1, fingerprint: "qa:src/a.ts:x" },
      { role: "qa", number: 2, fingerprint: "qa:src/b.ts:y" },
    ];
    const result = fileFinding(validFinding, { run, date: "2026-10-26", state: { filed } });
    expect(result.status).toBe("capped");
    expect(String(result.reason)).toContain("role cap");
  });
});

describe("daily-review digest", () => {
  it("picks the configured category, then General", () => {
    const categories = [
      { id: "1", name: "Ideas" },
      { id: "2", name: "General" },
    ];
    expect(pickCategory(categories, "Ideas")?.id).toBe("1");
    expect(pickCategory(categories, "Missing")?.id).toBe("2");
    expect(pickCategory([], "General")).toBeNull();
  });

  it("picks the rolling discussion by title", () => {
    expect(pickDiscussion([{ title: "Other" }, { title: "Daily reviews", id: "D" }])?.id).toBe("D");
    expect(pickDiscussion([], "Daily reviews")).toBeNull();
  });

  it("trims the digest body", () => {
    expect(renderDigestBody("\n  hello  \n")).toBe("hello\n");
  });

  it("creates the discussion once, then comments", () => {
    const calls: Array<{ query: string; variables: Record<string, string> }> = [];
    const graphql = vi.fn((query: string, variables: Record<string, string> = {}) => {
      calls.push({ query, variables });
      if (query.includes("discussionCategories")) {
        return { repository: { id: "REPO", discussionCategories: { nodes: [{ id: "CAT", name: "General" }] } } };
      }
      if (query.includes("search")) return { search: { nodes: [] } };
      if (query.includes("createDiscussion")) {
        return { createDiscussion: { discussion: { id: "DISC", title: "Daily reviews", url: "https://discussion" } } };
      }
      return { addDiscussionComment: { comment: { url: "https://comment" } } };
    });

    const result = postDigest({
      text: "### 2026-10-26\n\n**Filed:** none. **Theme:** a quiet day.\n",
      owner: "Cabeda",
      repo: "Convocados",
      graphql,
    });

    expect(result).toEqual({ status: "posted", discussion: "Daily reviews", url: "https://comment" });
    expect(calls.some((call) => call.query.includes("createDiscussion"))).toBe(true);
    expect(calls.some((call) => call.query.includes("addDiscussionComment"))).toBe(true);
  });

  it("does not mutate on a dry run", () => {
    const graphql = vi.fn((query: string) => {
      if (query.includes("discussionCategories")) {
        return { repository: { id: "REPO", discussionCategories: { nodes: [{ id: "CAT", name: "General" }] } } };
      }
      if (query.includes("search")) return { search: { nodes: [] } };
      return {};
    });

    const result = postDigest({
      text: "### 2026-10-26\n\nA digest long enough to pass the minimum length check.\n",
      owner: "Cabeda",
      repo: "Convocados",
      graphql,
      dryRun: true,
    });

    expect(result.status).toBe("would-create");
    expect(graphql).toHaveBeenCalledTimes(2);
  });
});
