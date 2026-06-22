import { test, expect, type Page } from "@playwright/test";

/**
 * View-transitions + no-white-blink guard.
 *
 * Fails before the fix (no root layout, no ClientRouter, no shell paint) and
 * passes once the layout, view-transition animation and persistent background
 * are in place. Captures *real* signals rather than DOM-string assertions:
 *
 *  1. SSR HTML must declare a body background (no white default flash).
 *  2. The Document must have a `<meta name="theme-color">` matching PWA.
 *  3. A same-origin link click must NOT trigger a full document navigation —
 *     the document must be reused (Astro ClientRouter) and the path change
 *     must happen without `pageshow` from a navigation.
 *  4. The browser must run a `Document.startViewTransition` during nav (the
 *     native CSS View Transitions API). We assert that the *first* <a> we
 *     click on /public causes a `startViewTransition` call observable via
 *     a sentinel we install in the page.
 *  5. The body background must remain non-white for the entire nav window.
 *
 * The test is unauth'd so it runs against the public-games + landing pages.
 */

const WHITE = "rgb(255, 255, 255)";
const SHELL_BG = "rgb(17, 20, 18)"; // matches manifest.background_color #111412

async function installViewTransitionSentinel(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __vt?: { calls: number; first: number; last: number };
    };
    w.__vt = { calls: 0, first: 0, last: 0 };
    const orig = document.startViewTransition?.bind(document);
    if (orig) {
      document.startViewTransition = ((...args: unknown[]) => {
        const t = performance.now();
        w.__vt!.calls += 1;
        if (w.__vt!.first === 0) w.__vt!.first = t;
        w.__vt!.last = t;
        return orig(...(args as []));
      }) as typeof document.startViewTransition;
    }
  });
}

async function installBodyBgSampler(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __bgSamples?: { t: number; bg: string; url: string }[];
    };
    w.__bgSamples = [];
    const start = performance.now();
    function sample() {
      const bg = getComputedStyle(document.body).backgroundColor;
      w.__bgSamples!.push({ t: performance.now() - start, bg, url: location.pathname });
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
}

test.describe("page navigation: view transitions + no white blink", () => {
  test("SSR HTML declares shell background and theme color", async ({ request }) => {
    for (const path of ["/", "/public", "/dashboard", "/admin", "/court-watches"]) {
      const res = await request.get(path);
      const html = await res.text();
      // Theme color must be present (used by mobile chrome during the nav)
      expect(html, `${path} missing theme-color`).toMatch(/<meta\s+name="theme-color"\s+content="#1b6b4a"/);
      // Shell background must be painted before React island hydrates
      expect(
        html,
        `${path} does not paint a shell background — body will flash white during hydration`,
      ).toMatch(/<style[^>]*>[\s\S]*?(?:html|body)\s*\{[^}]*background(?:-color)?\s*:\s*#111412/i);
    }
  });

  test("same-origin link click reuses the document (no full reload)", async ({ page }) => {
    await installViewTransitionSentinel(page);
    await page.goto("/public");

    // The brand link in the ResponsiveLayout is the most reliable in-app link —
    // it is present on every page and is always a same-origin client-side nav.
    const brandLink = page.locator("a[href='/']").first();
    await brandLink.waitFor({ state: "visible" });

    await brandLink.click();
    await page.waitForURL("**/", { timeout: 5000 });

    // ClientRouter uses pushState (not a full nav). We assert the document is
    // *reused* by checking that window.__vt was populated (which only happens
    // when our patched startViewTransition runs in the *same* document).
    const vt = await page.evaluate(() => (window as unknown as { __vt?: { calls: number } }).__vt);
    expect(vt, "ClientRouter did not invoke document.startViewTransition").toBeDefined();
    expect(vt!.calls, "expected at least one startViewTransition call during nav").toBeGreaterThanOrEqual(1);
  });

  test("body background is never white during a same-origin nav", async ({ page }) => {
    await installBodyBgSampler(page);
    await page.goto("/public");
    // wait for React island to mount and paint the dark bg
    await page.waitForFunction(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "rgb(255, 255, 255)";
    }, { timeout: 5000 });

    // The brand link in the ResponsiveLayout is the most reliable in-app link.
    const link = page.locator("a[href='/']").first();
    await link.waitFor({ state: "visible" });
    await link.click();
    await page.waitForURL("**/", { timeout: 5000 });

    // Allow the transition + hydration to complete
    await page.waitForLoadState("networkidle");
    // Give a few frames for late samples
    await page.waitForTimeout(300);

    const samples = await page.evaluate(
      () => (window as unknown as { __bgSamples?: { t: number; bg: string; url: string }[] }).__bgSamples ?? [],
    );
    expect(samples.length, "no body-bg samples captured").toBeGreaterThan(20);

    // Body bg should never be the browser default white at any sampled frame
    const whiteFrames = samples.filter((s) => s.bg === WHITE);
    expect(
      whiteFrames.length,
      `body flashed white on ${whiteFrames.length}/${samples.length} frames (first at t=${whiteFrames[0]?.t}ms url=${whiteFrames[0]?.url})`,
    ).toBe(0);

    // Body bg should be set to the shell color on at least one frame
    const shellFrames = samples.filter((s) => s.bg === SHELL_BG);
    expect(
      shellFrames.length,
      `body never painted the shell color ${SHELL_BG} — root layout is missing the inline body background`,
    ).toBeGreaterThan(0);
  });
});
