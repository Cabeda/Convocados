/**
 * The goldens must be an output of the unit-test task, or a stale golden is
 * invisible to Gradle.
 *
 * The failure this replaces: the screenshots were not declared as outputs, so
 * Gradle could serve the test task `UP-TO-DATE` — or `FROM-CACHE` — while the
 * PNGs on disk held an *older* render. `verifyRoborazziDebug` then compared the
 * stale golden against the stale render and went green on a change it never
 * saw. The record task printed success and left the wrong picture in the
 * commit.
 *
 * The configuration is asserted rather than the behaviour: running Gradle from a
 * unit test is minutes per run, and the CI job that *does* run the recorder
 * (`Verify Wear screenshots`) is the behavioural proof. What is guarded here is
 * that neither module loses the setting.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const modules = [
  "android-app/app/build.gradle.kts",
  "android-app/wear/build.gradle.kts",
];

describe("the goldens are an output of the unit-test task", () => {
  it.each(modules)("%s declares the screenshot directory as a test output", (file) => {
    const build = readFileSync(join(root, file), "utf8");

    expect(
      build,
      `${file} must declare the goldens as an output of the unit-test task — otherwise a stale golden compares equal to a stale render and the gate goes green on a change it never saw`,
    ).toMatch(/outputs\.dir\([^)]*src\/test\/screenshots/);
  });
});
