// GH #1209 — better-auth session-store teardown vs jsdom environment teardown.
//
// Chain of events behind the CI flake:
// 1. A jsdom test renders a component that subscribes to better-auth's session
//    atom (`authClient.$store.atoms.session`, via `useSession`).
// 2. The component unmounts (RTL cleanup in afterEach) → last listener leaves
//    the nanostores atom.
// 3. nanostores' `onMount` defers the unmount destroys by STORE_UNMOUNT_DELAY
//    (1000ms) — see nanostores lifecycle `off()`. One of those destroys is
//    better-auth's `refreshManager.cleanup()`, whose
//    `cleanupBroadcastSetup` closure calls bare `window.removeEventListener`
//    (better-auth broadcast-channel.mjs: no `typeof window` guard in the
//    cleanup, unlike `setup()`).
// 4. The test file usually finishes well within that 1s window. Vitest tears
//    down jsdom (deleting `globalThis.window`), and up to a second later the
//    deferred destroy fires in the bare worker → `ReferenceError: window is
//    not defined` → vitest fails the entire shard with every test green.
//
// The harness cannot reach nanostores' `cleanStores` without adding a direct
// dependency on better-auth's internal store library (module-instance-fragile),
// so instead it detects the pending deferred unmount and out-waits the delay
// while the jsdom environment is still alive, via `afterAll` in jsdom-setup.ts.

import { authClient } from "~/lib/auth.client";

/** nanostores' internal unmount delay (lifecycle STORE_UNMOUNT_DELAY). */
const STORE_UNMOUNT_DELAY_MS = 1000;
/** Extra margin so the deferred destroy timer has definitely fired. */
const FLUSH_MARGIN_MS = 100;

interface MaybeNanostore {
  active?: boolean;
  lc?: number;
}

function sessionStore(): MaybeNanostore | undefined {
  return (
    authClient as unknown as {
      $store?: { atoms?: { session?: MaybeNanostore } };
    }
  )?.$store?.atoms?.session;
}

/**
 * True when the session atom is mounted-but-empty: its last listener left, so
 * nanostores has scheduled the unmount destroys (broadcast/focus/online
 * cleanup) for STORE_UNMOUNT_DELAY ms from now. That is exactly the callback
 * that outlives jsdom and throws "window is not defined" post-teardown.
 */
export function hasPendingAuthSessionUnmount(): boolean {
  const session = sessionStore();
  return session?.active === true && (session?.lc ?? 0) === 0;
}

/**
 * Block until nanostores' deferred unmount destroys have run. Call from a
 * file-level `afterAll` so the destroys execute while the jsdom environment
 * (window/document) still exists, instead of after vitest has torn it down.
 * No-op when no unmount is pending.
 */
export async function flushPendingAuthSessionUnmount(): Promise<void> {
  if (!hasPendingAuthSessionUnmount()) return;
  await new Promise((resolve) =>
    setTimeout(resolve, STORE_UNMOUNT_DELAY_MS + FLUSH_MARGIN_MS)
  );
}

/**
 * File-level flush-hook registrations. Only `registerAuthSessionFlushHook()`
 * increments it, so a test asserting `flushHookRegistrationCount() >= 1`
 * proves jsdom-setup.ts still wires the `afterAll` — deleting that line is
 * the silent regression this counter exists to catch (GH #1209).
 */
let flushHookRegistrations = 0;

export function flushHookRegistrationCount(): number {
  return flushHookRegistrations;
}

/**
 * Count a file-level registration and return the callback for
 * `afterAll(registerAuthSessionFlushHook())` in jsdom-setup.ts. Registration
 * and flush are one call so the wiring cannot be separated from the signal.
 */
export function registerAuthSessionFlushHook(): () => Promise<void> {
  flushHookRegistrations += 1;
  return flushPendingAuthSessionUnmount;
}
