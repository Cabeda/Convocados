/**
 * Repository governance guards for GH-1088 / dex rdnhhh42:
 * CLA wiring, trademark reservation, and CONTRIBUTING pointer must stay in
 * place — deleting any of them silently drops the relicenseable-contribution
 * safety net that FSL-1.1-ALv2 depends on.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const CLA_ACTION = "contributor-assistant/github-action";
const CLA_ACTION_REF = `${CLA_ACTION}@v2.6.1`;

/**
 * Inputs declared by contributor-assistant/github-action@v2.6.1 (its
 * action.yml). Passing an undeclared key makes the action abort before it can
 * read the allowlist, so the maintainer exemption silently never applies.
 * Bumping the action ref below means re-checking this set against its action.yml.
 */
const CLA_ACTION_INPUTS = new Set([
  "path-to-signatures",
  "branch",
  "allowlist",
  "remote-repository-name",
  "remote-organization-name",
  "path-to-document",
  "signed-commit-message",
  "signed-empty-commit-message",
  "create-file-commit-message",
  "custom-notsigned-prcomment",
  "custom-pr-sign-comment",
  "custom-allsigned-prcomment",
  "use-dco-flag",
  "lock-pullrequest-aftermerge",
  "suggest-recheck",
]);

describe("repository governance (GH-1088)", () => {
  it("CLA.md exists and grants copyright + patent rights to the maintainer", () => {
    expect(existsSync(resolve(root, "CLA.md"))).toBe(true);
    const cla = read("CLA.md");
    expect(cla).toMatch(/grant.*copyright license/is);
    expect(cla).toMatch(/patent/i);
    expect(cla).toMatch(/trademark/i);
    expect(cla).toMatch(/José Cabeda/);
  });

  it("CLA workflow runs on pull requests and allowlists the maintainer", () => {
    expect(existsSync(resolve(root, ".github/workflows/cla.yml"))).toBe(true);
    const wf = read(".github/workflows/cla.yml");
    expect(wf).toMatch(/pull_request_target|pull_request/);
    expect(wf).toMatch(/contributor-assistant\/github-action/);
    expect(wf).toMatch(/allowlist/);
    expect(wf).toMatch(/Cabeda/);
    expect(wf).toMatch(/CLA\.md/);
  });

  it("CLA workflow passes only inputs the action declares", () => {
    const wf = parseYaml(read(".github/workflows/cla.yml"));
    const steps = wf.jobs.cla.steps as Array<{ uses?: string; with?: Record<string, unknown> }>;
    const step = steps.find((s) => String(s.uses ?? "").startsWith(CLA_ACTION));
    expect(step).toBeTruthy();
    // CLA_ACTION_INPUTS mirrors this exact ref; a bump must re-verify the schema.
    expect(step!.uses).toBe(CLA_ACTION_REF);

    const withBlock = step!.with ?? {};
    const keys = Object.keys(withBlock);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !CLA_ACTION_INPUTS.has(k))).toEqual([]);

    // The exemption never applied because the key name was wrong (allow-list).
    expect(String(withBlock.allowlist)).toContain("Cabeda");
    // Signatures are stored as JSON; a .txt path is the wrong store format.
    expect(String(withBlock["path-to-signatures"])).toMatch(/\.json$/);
    expect(withBlock["allow-list"]).toBeUndefined();
  });

  it("TRADEMARK.md exists and reserves the Convocados name separately from the code license", () => {
    expect(existsSync(resolve(root, "TRADEMARK.md"))).toBe(true);
    const tm = read("TRADEMARK.md");
    expect(tm).toMatch(/Convocados/);
    expect(tm).toMatch(/José Cabeda/);
    expect(tm).toMatch(/LICENSE/);
    expect(tm).toMatch(/endorse/i);
  });

  it("LICENSE keeps the trademark exclusion in the FSL terms", () => {
    const license = read("LICENSE");
    expect(license).toMatch(/trademarks?, trade names/i);
    expect(license).toMatch(/FSL-1\.1-ALv2/);
  });

  it("CONTRIBUTING.md points contributors at the CLA", () => {
    expect(existsSync(resolve(root, "CONTRIBUTING.md"))).toBe(true);
    const contributing = read("CONTRIBUTING.md");
    expect(contributing).toMatch(/CLA\.md/);
    expect(contributing).toMatch(/pull request/i);
    expect(contributing).toMatch(/test/i);
  });

  it("ADR 0041 describes Discover's region ranking, not global soonest-first", () => {
    const adr = read("docs/adr/0041-signed-in-home-up-next-and-discover.md");
    // Discover is region-ranked (rankDiscover orders by distance to the inferred
    // origin). The ADR must record that supersession rather than repeat the
    // original "soonest-first" wording — the doc and code drifted before.
    expect(adr).toMatch(/region-first/i);
    expect(adr).toMatch(/supersedes/i);
    expect(adr).not.toMatch(/Soonest-first,\s*\n?\s*capped at 3/i);
  });
});
