import { describe, it, expect } from "vitest";
import { logger, createLogger } from "~/lib/logger.server";

describe("logger", () => {
  it("should export a pino logger instance", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("should create child loggers with module field", () => {
    const child = createLogger("test-module");
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
    // Child logger should have the module binding
    expect((child as any).bindings().module).toBe("test-module");
  });

  it("should be silent in test environment", () => {
    // In test env, logger level should be 'silent' to avoid noisy output
    expect(logger.level).toBe("silent");
  });
});
