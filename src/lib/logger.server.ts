import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

/**
 * Structured logger for the application.
 * - Production: JSON output for log aggregation
 * - Development: Pretty-printed for readability
 * - Test: Silent to avoid noisy test output
 */
export const logger = pino({
  level: isTest ? "silent" : (process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug")),
  ...(isProduction || isTest
    ? {} // JSON output in production, silent in test (no transport needed)
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
});

/** Create a child logger scoped to a module. */
export function createLogger(module: string) {
  return logger.child({ module });
}
