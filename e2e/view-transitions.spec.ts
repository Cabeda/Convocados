import { test, expect, type Page } from "@playwright/test";

/**
 * BaseLayout shell-paint + click-through regression test.
 *
 * Captures the invariants we can guarantee in this Astro 6 + React 19 +
 * `client:only="react"` environment. The view-transition / soft-nav /
 * persistent-shell features from ADR 0015 and 0016 are disabled because
 * the upstream iframe-based `client:only` swap in Astro's ClientRouter
 * is broken (the new page's React component never mounts after the swap).
 * See ADR 0015 and 0016 for the full story.
 *
 * What this suite asserts:
 *  1. SSR HTML must declare a body background (no white default flash).
 *  2. The Document must have a `<meta name="theme-color">` matching PWA.
 *  3. The body background must remain non-white during a navigation.
 *  4. Clicking a nav link must actually render the new page (the regression
 *     that motivated the disable of ClientRouter — without a working
 *     view transition, every nav must at least land the user on the
 *     right page with a full document load).
 *
 * The test is unauth'd so it runs against the public-games + landing pages.
 */

const WHITE = "rgb(255, 255, 255)";
const SHELL_BG = "rgb(17, 20, 18)"; // matches manifest.background_color #111412


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
    // Full document nav now (no ClientRouter). Wait for the new page to load.
    await page.waitForURL("**/", { timeout: 5000 });
    await page.waitForLoadState("domcontentloaded");
    // Give a few frames for the body-bg sample to capture the new page.
    await page.waitForTimeout(300);

    const samples = await page.evaluate(
      () => (window as unknown as { __bgSamples?: { t: number; bg: string; url: string }[] }).__bgSamples ?? [],
    );
    expect(samples.length, "no body-bg samples captured").toBeGreaterThan(10);

    // Body bg should never be the browser default white at any sampled frame.
    // For full-document navs we also see the brief moment where the old
    // page is gone but the new one isn't yet loaded — the shell paint in
    // BaseLayout ensures that gap is dark, not white.
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

  test("clicking a nav link renders the new page (regression: blank page after nav)", async ({ page }) => {
    // Regression test for a real bug we hit and fixed. With ClientRouter
    // disabled (see ADR 0016), every navigation is a full document load.
    // The page must still render the new content — no blank page, no
    // white blink, no JavaScript error.
    test.setTimeout(90000);

    // Start on /public
    await page.goto("/public");
    await page.waitForFunction(() => {
      return document.body.innerText.includes("Public Games") &&
        document.body.innerText.length > 200;
    }, { timeout: 10000 });

    // Navigate to /. Wait for the landing form input to appear (unambiguous
    // signal that LandingPage mounted).
    await page.locator("a[href='/']").first().click();
    await page.waitForURL("**/", { timeout: 15000 });
    await page.waitForSelector("input[name='title']", { timeout: 20000 });

    const landingState = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      hasHero: document.body.innerText.includes("Organize your game"),
      hasForm: !!document.querySelector("input[name='title']"),
      bodyLen: document.body.innerText.length,
    }));
    expect(landingState.url, "URL did not change to /").toMatch(/\/$/);
    expect(landingState.title, "title did not update").toContain("Organize your game");
    expect(landingState.hasHero, "landing hero text not rendered after nav").toBe(true);
    expect(landingState.hasForm, "landing form not rendered after nav").toBe(true);
    expect(landingState.bodyLen, "body is suspiciously short after nav").toBeGreaterThan(200);

    // And the reverse: from /, click into /public again. Wait for the public
    // page's heading to appear. Full doc nav in CI is slow — give it room.
    await page.locator("a[href='/public']").first().click();
    await page.waitForURL("**/public", { timeout: 15000 });
    await page.waitForFunction(() => {
      return document.body.innerText.includes("Public Games") &&
        document.body.innerText.length > 200;
    }, { timeout: 20000 });

    const publicState = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      hasHeading: document.body.innerText.includes("Public Games"),
      hasFilter: document.body.innerText.includes("Sport") && document.body.innerText.includes("Has spots"),
      bodyLen: document.body.innerText.length,
    }));
    expect(publicState.url, "URL did not change to /public").toMatch(/\/public$/);
    expect(publicState.title, "title did not update").toContain("Public Games");
    expect(publicState.hasHeading, "public heading not rendered after nav").toBe(true);
    expect(publicState.hasFilter, "public filter bar not rendered after nav").toBe(true);
    expect(publicState.bodyLen, "body is suspiciously short after nav").toBeGreaterThan(200);
  });
});
