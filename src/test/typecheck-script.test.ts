import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

describe("typecheck script", () => {
  it("invokes a binary that a clean install actually links", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(projectRoot, "package.json"), "utf8"),
    ) as { scripts: { typecheck: string } };

    const [binary] = pkg.scripts.typecheck.trim().split(/\s+/);

    expect(binary).toBeTruthy();
    expect(
      existsSync(resolve(projectRoot, "node_modules/.bin", binary)),
    ).toBe(true);
  });
});
