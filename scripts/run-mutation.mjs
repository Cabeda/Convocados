import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MINUTES = 120;
const timeoutMinutes = Number.isFinite(
  Number(process.env.MUTATION_TIMEOUT_MINUTES),
)
  ? Number(process.env.MUTATION_TIMEOUT_MINUTES)
  : DEFAULT_TIMEOUT_MINUTES;
const timeoutMs = timeoutMinutes * 60 * 1000;
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function terminateProcessGroup(pid, signal) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function runMutation() {
  const child = spawn(npxCommand, ["--no-install", "stryker", "run"], {
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      VITEST_SINGLE_THREAD: "1",
    },
    stdio: "inherit",
  });

  let settled = false;
  let timedOut = false;
  let timeoutHandle;
  let killHandle;

  const cleanup = () => {
    clearTimeout(timeoutHandle);
    clearTimeout(killHandle);
    terminateProcessGroup(child.pid, "SIGTERM");
  };

  const settle = (exitCode) => {
    if (settled) return;
    settled = true;
    cleanup();
    process.exitCode = exitCode;
  };

  timeoutHandle = setTimeout(() => {
    timedOut = true;
    console.error(
      `Mutation testing exceeded ${timeoutMinutes} minutes; terminating its process group.`,
    );
    terminateProcessGroup(child.pid, "SIGTERM");
    killHandle = setTimeout(() => {
      terminateProcessGroup(child.pid, "SIGKILL");
    }, 10_000);
  }, timeoutMs);

  child.on("error", (error) => {
    console.error("Unable to start mutation testing:", error);
    settle(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`Mutation testing exited with signal ${signal}.`);
      settle(1);
      return;
    }
    settle(timedOut ? 1 : (code ?? 1));
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      terminateProcessGroup(child.pid, signal);
      settle(1);
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMutation();
}
