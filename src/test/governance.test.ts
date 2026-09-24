/**
 * Repository governance guards for GH-1088 / dex rdnhhh42:
 * CLA wiring, trademark reservation, and CONTRIBUTING pointer must stay in
 * place — deleting any of them silently drops the relicenseable-contribution
 * safety net that FSL-1.1-ALv2 depends on.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("repository governance (GH-1088)", () => {
  it("CLA.md exists and grants copyright + patent rights to the maintainer", () => {
    expect(existsSync(resolve(root, "CLA.md"))).toBe(true);
    const cla = read("CLA.md");
    expect(cla).toMatch(/grant.*copyright license/is);
    expect(cla).toMatch(/patent/i);
    expect(cla).toMatch(/trademark/i);
    expect(cla).toMatch(/José Cabeda/);
  });

  it("CLA workflow runs on pull requests and allow-lists the maintainer", () => {
    expect(existsSync(resolve(root, ".github/workflows/cla.yml"))).toBe(true);
    const wf = read(".github/workflows/cla.yml");
    expect(wf).toMatch(/pull_request_target|pull_request/);
    expect(wf).toMatch(/contributor-assistant\/github-action/);
    expect(wf).toMatch(/allow-list/);
    expect(wf).toMatch(/Cabeda/);
    expect(wf).toMatch(/CLA\.md/);
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
});
