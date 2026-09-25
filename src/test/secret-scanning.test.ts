import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

function hasGitleaks(): boolean {
  const probe = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  return probe.status === 0;
}

describe("secret scanning hooks", () => {
  it("does not blanket-allowlist playwright.config.ts in the gitleaks config", () => {
    const config = readProjectFile(".gitleaks.toml");

    expect(config).not.toMatch(/['"]{3}\s*playwright/);
  });

  it("installs a pre-commit hook that runs the staged secret scan", () => {
    const hook = readProjectFile("scripts/pre-commit.sh");
    const installer = readProjectFile("scripts/install-hooks.sh");

    expect(hook).toMatch(/secret-scan\.sh"?\s+staged/);
    expect(installer).toContain("pre-commit.sh");
    expect(installer).toContain("pre-commit");
  });

  it("scans the pushed commit range, never the index, from the pre-push hook", () => {
    const hook = readProjectFile("scripts/pre-push.sh");

    expect(hook).toMatch(/secret-scan\.sh"?\s+push/);
    expect(hook).not.toMatch(/gitleaks\s+protect\s+--staged/);
  });

  it("uses staged mode for pre-commit and a log range for pre-push", () => {
    const scanner = readProjectFile("scripts/secret-scan.sh");

    expect(scanner).toMatch(/gitleaks git --staged/);
    expect(scanner).toMatch(/--log-opts/);
    expect(scanner).toContain("push");
  });

  it("keeps every hardcoded VAPID key out of playwright.config.ts", () => {
    const config = readProjectFile("playwright.config.ts");

    // Any 40+ char url-safe literal in this file is a leaked key fallback.
    expect(config).not.toMatch(/["'][A-Za-z0-9_-]{40,}["']/);
  });

  describe.runIf(hasGitleaks())("gitleaks config (requires gitleaks)", () => {
    it("allows the VAPID private key via allowlist", () => {
      const dir = mkdtempSync(join(tmpdir(), "gitleaks-"));
      const fixture = join(dir, "vapid.env");
      writeFileSync(fixture, "VAPID_PRIVATE_KEY=CiPrdEcokfW8WIFvj1bptu0y6ybCtS3YlWlBCjvAF8M\n");

      const result = spawnSync(
        "gitleaks",
        ["dir", fixture, "--config", join(projectRoot, ".gitleaks.toml"), "--no-banner", "--redact"],
        { encoding: "utf8" },
      );

      expect(result.status).toBe(0);
    });
  });
});
