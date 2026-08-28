import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

describe("mutation quality gate", () => {
  it("keeps native SQLite mutation runners serialized", () => {
    const config = readProjectFile("stryker.config.mjs");
    const packageManifest = readProjectFile("package.json");

    expect(config).toMatch(/concurrency:\s*1/);
    expect(config).toMatch(/timeoutMS:\s*30000/);
    expect(packageManifest).toContain(
      '"test:mutation": "node scripts/run-mutation.mjs"',
    );
    const runner = readProjectFile("scripts/run-mutation.mjs");

    expect(runner).toContain('VITEST_SINGLE_THREAD: "1"');
    expect(runner).toContain("detached: process.platform !== \"win32\"");
    expect(runner).toContain("MUTATION_TIMEOUT_MINUTES");
    expect(runner).toContain('terminateProcessGroup(child.pid, "SIGTERM")');
    expect(runner).toContain('terminateProcessGroup(child.pid, "SIGKILL")');
  });

  it("terminates and fails a timed-out mutation run", async () => {
    const output: string[] = [];
    const child = spawn(process.execPath, ["scripts/run-mutation.mjs"], {
      cwd: projectRoot,
      env: { ...process.env, MUTATION_TIMEOUT_MINUTES: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => output.push(String(chunk)));
    child.stderr.on("data", (chunk) => output.push(String(chunk)));

    const result = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        const guard = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("mutation runner did not honor its timeout"));
        }, 10_000);
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          clearTimeout(guard);
          resolve({ code, signal });
        });
      },
    );

    expect(result.code).not.toBe(0);
    expect(output.join("")).toContain("exceeded 0 minutes");
  });

  it("keeps the flaky mutation run out of the pre-push hook", () => {
    const hook = readProjectFile("scripts/pre-push.sh");

    expect(hook).not.toMatch(/^\s*(?:npm|pnpm) (?:run )?test:mutation\b/m);
    expect(hook).toContain("Mutation testing is no longer a pre-push gate");
  });

  it("provides a bounded, manually triggered CI mutation job", () => {
    const workflow = readProjectFile(".github/workflows/mutation.yml");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("timeout-minutes: 120");
    expect(workflow).toContain('MUTATION_TIMEOUT_MINUTES: "110"');
    expect(workflow).toContain("pnpm test:mutation");
  });
});
