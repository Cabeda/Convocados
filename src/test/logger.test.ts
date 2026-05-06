import { describe, it, expect, vi, beforeEach } from "vitest";

const pinoFactory = vi.fn(() => ({ level: "info", info: vi.fn(), child: vi.fn(() => ({ info: vi.fn() })) }));
vi.mock("pino", () => ({
  default: pinoFactory,
}));

describe("logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOG_LEVEL;
  });

  it("exports a logger instance", async () => {
    const { logger, createLogger } = await import("~/lib/logger.server");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    const child = createLogger("test");
    expect(child).toBeDefined();
  });

  it("sets silent level in test env", async () => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    await import("~/lib/logger.server");
    const call = pinoFactory.mock.calls[pinoFactory.mock.calls.length - 1] as any;
    expect(call[0].level).toBe("silent");
  });

  it("sets info level in production env", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
    await import("~/lib/logger.server");
    const call = pinoFactory.mock.calls[pinoFactory.mock.calls.length - 1] as any;
    expect(call[0].level).toBe("info");
  });

  it("sets debug level in development env", async () => {
    process.env.NODE_ENV = "development";
    vi.resetModules();
    await import("~/lib/logger.server");
    const call = pinoFactory.mock.calls[pinoFactory.mock.calls.length - 1] as any;
    expect(call[0].level).toBe("debug");
  });

  it("uses LOG_LEVEL when set", async () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "warn";
    vi.resetModules();
    await import("~/lib/logger.server");
    const call = pinoFactory.mock.calls[pinoFactory.mock.calls.length - 1] as any;
    expect(call[0].level).toBe("warn");
  });

  it("uses pretty transport in development", async () => {
    process.env.NODE_ENV = "development";
    vi.resetModules();
    await import("~/lib/logger.server");
    const call = pinoFactory.mock.calls[pinoFactory.mock.calls.length - 1] as any;
    expect(call[0].transport).toBeDefined();
  });

  it("uses JSON output in production", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
    await import("~/lib/logger.server");
    const call = pinoFactory.mock.calls[pinoFactory.mock.calls.length - 1] as any;
    expect(call[0].transport).toBeUndefined();
  });
});
