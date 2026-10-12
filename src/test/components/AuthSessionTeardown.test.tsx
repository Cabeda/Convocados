import { afterEach, describe, expect, it, vi } from "vitest";
import { authClient } from "~/lib/auth.client";
import {
  flushHookRegistrationCount,
  flushPendingAuthSessionUnmount,
  hasPendingAuthSessionUnmount,
} from "../auth-teardown";

// Regression test for GH #1209: better-auth's session-store unmount destroys
// (broadcast/focus/online cleanup) are deferred by nanostores for 1000ms after
// the last unsubscribe. When they fired after vitest tore down jsdom, the
// cleanup's bare `window.removeEventListener` threw "window is not defined"
// and failed the whole shard with every test green. The jsdom-setup afterAll
// must flush that deferred destroy while window still exists — asserted here
// by driving the harness directly.
describe("jsdom teardown: better-auth session store (GH #1209)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flushes the deferred session-store unmount before the environment dies", async () => {
    // better-auth captured `fetch` at import (config.mjs -> customFetchImpl),
    // so a global stub installed here cannot intercept the mount-fetch issued
    // during the 1.1s flush; it reaches localhost:3000 and fails closed.
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const session = authClient.$store.atoms.session;

    const unsubscribe = session.listen(() => {});
    expect(hasPendingAuthSessionUnmount()).toBe(false);

    unsubscribe();
    // nanostores has scheduled the unmount destroys for +1000ms; if jsdom
    // were torn down before then, cleanupBroadcastSetup would throw.
    expect(hasPendingAuthSessionUnmount()).toBe(true);

    await flushPendingAuthSessionUnmount();

    expect(hasPendingAuthSessionUnmount()).toBe(false);
    // The destroy ran while window existed: better-auth removed its storage
    // listener instead of blowing up post-teardown.
    expect(removeSpy).toHaveBeenCalledWith("storage", expect.any(Function));
  });

  // The harness above only proves the internals; the fix for #1209 is the
  // wiring — jsdom-setup.ts's file-level `afterAll(registerAuthSessionFlushHook())`.
  // This counter is incremented only by that registration call, so deleting
  // the setup-file hook goes red here instead of silently reintroducing the
  // shard-level false failure.
  it("jsdom-setup registers the file-level flush hook", () => {
    expect(flushHookRegistrationCount()).toBeGreaterThanOrEqual(1);
  });
});
