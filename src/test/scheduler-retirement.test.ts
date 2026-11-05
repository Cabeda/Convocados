import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("scheduler after court integration retirement", () => {
  it("runs ordinary maintenance at pickup time without triggering retired court sweeps", () => {
    const dir = mkdtempSync(join(tmpdir(), "scheduler-retirement-"));
    try {
      const preload = join(dir, "preload.mjs");
      writeFileSync(preload, `
        const urls = [];
        Date.now = () => Date.UTC(2026, 10, 4, 9);
        Date.prototype.getUTCHours = () => 9;
        globalThis.fetch = async (url) => {
          urls.push(new URL(url).pathname);
          if (url.endsWith('/api/internal/jobs/due')) {
            console.log('REQUESTS:' + JSON.stringify(urls));
            process.exit(0);
          }
          return Response.json({ ok: true });
        };
      `);
      const result = spawnSync(process.execPath, ["--import", preload, "scheduler/index.ts"], {
        env: { ...process.env, SCHEDULER_SECRET: "test-scheduler-secret" }, encoding: "utf8", timeout: 10_000,
      });
      expect(result.status, result.stderr).toBe(0);
      const line = result.stdout.split("\n").find((value) => value.startsWith("REQUESTS:"));
      expect(line).toBeDefined();
      expect(JSON.parse(line!.slice("REQUESTS:".length))).toEqual([
        "/api/cron/reminders", "/api/cron/db-maintenance", "/api/cron/advance-recurring",
        "/api/cron/invite-expiry", "/api/internal/jobs/due",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
