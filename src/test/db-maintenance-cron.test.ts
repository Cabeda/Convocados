import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("~/lib/db.server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("~/lib/db.server")>();
  return { ...mod, runDbOptimize: vi.fn().mockResolvedValue([]) };
});

import { POST } from "~/pages/api/cron/db-maintenance";
import { runDbOptimize } from "~/lib/db.server";

const mockRunDbOptimize = vi.mocked(runDbOptimize);

function cronReq(secret?: string) {
  return {
    request: new Request("http://localhost/api/cron/db-maintenance", {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
  } as any;
}

describe("POST /api/cron/db-maintenance", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockRunDbOptimize.mockClear();
  });

  it("rejects 401 when CRON_SECRET is set but authorization is missing", async () => {
    vi.stubEnv("CRON_SECRET", "secret123");
    const res = await POST(cronReq());
    expect(res.status).toBe(401);
    expect(mockRunDbOptimize).not.toHaveBeenCalled();
  });

  it("rejects 401 when CRON_SECRET is set but authorization is wrong", async () => {
    vi.stubEnv("CRON_SECRET", "secret123");
    const res = await POST(cronReq("wrong"));
    expect(res.status).toBe(401);
    expect(mockRunDbOptimize).not.toHaveBeenCalled();
  });

  it("runs PRAGMA optimize and returns ok with the correct secret", async () => {
    vi.stubEnv("CRON_SECRET", "secret123");
    const res = await POST(cronReq("secret123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockRunDbOptimize).toHaveBeenCalledTimes(1);
  });

  it("runs optimize without a secret when CRON_SECRET is unset", async () => {
    const res = await POST(cronReq());
    expect(res.status).toBe(200);
    expect(mockRunDbOptimize).toHaveBeenCalledTimes(1);
  });
});