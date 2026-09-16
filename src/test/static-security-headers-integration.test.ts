import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { staticSecurityHeaders } from "~/integrations/staticSecurityHeaders";
import { SECURITY_HEADERS } from "~/lib/securityHeaders";

type Hooks = {
  "astro:config:done": (args: { config: { outDir: URL } }) => void;
  "astro:build:done": (args: {
    logger: { info: (msg: string) => void; warn: (msg: string) => void };
  }) => Promise<void>;
};

describe("staticSecurityHeaders integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-headers-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function build(outDir: string): Promise<string> {
    const hooks = staticSecurityHeaders().hooks as unknown as Hooks;
    hooks["astro:config:done"]({ config: { outDir: pathToFileURL(`${outDir}/`) } });
    await hooks["astro:build:done"]({ logger: { info: () => {}, warn: () => {} } });
    return path.join(outDir, "security-headers.json");
  }

  // scripts/server.mjs reads this file at startup and applies it to every
  // response, which is what puts headers on prerendered pages.
  it("writes the shared header map into the build output", async () => {
    const target = await build(dir);
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual(SECURITY_HEADERS);
  });

  it("creates the output directory when it does not exist", async () => {
    const nested = path.join(dir, "nested");
    const target = await build(nested);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("emits the headers the prerendered pages were missing", async () => {
    const target = await build(dir);
    const written = JSON.parse(fs.readFileSync(target, "utf8")) as Record<string, string>;
    for (const key of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(written[key]).toBeTruthy();
    }
  });
});
