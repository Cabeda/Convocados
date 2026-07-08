import { test, expect } from "@playwright/test";

/**
 * View transitions + shell paint tests.
 *
 * Validates:
 *  1. SSR HTML declares shell background + theme-color (no white flash)
 *  2. @view-transition CSS rule is present (enables browser-native transitions)
 *  3. Body background is dark after load (shell paint works)
 *  4. Pages render React islands correctly on direct load
 */

test.describe("view transitions + shell paint", () => {
  test("SSR HTML has shell background, theme-color, and @view-transition", async ({ request }) => {
    for (const path of ["/", "/public"]) {
      const res = await request.get(path);
      const html = await res.text();
      expect(html, `${path} missing theme-color`).toMatch(/<meta\s+name="theme-color"\s+content="#1b6b4a"/);
      expect(
        html,
        `${path} missing shell background`,
      ).toMatch(/background(?:-color)?\s*:\s*#111412/);
      expect(html, `${path} missing @view-transition`).toContain("@view-transition");
    }
  });

  test("body background is dark on load (no white flash)", async ({ page }) => {
    await page.goto("/public");
    await page.waitForLoadState("domcontentloaded");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe("rgb(255, 255, 255)");
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("React island mounts on /public", async ({ page }) => {
    await page.goto("/public");
    await page.waitForFunction(
      () => document.body.innerText.includes("Public Games") && document.body.innerText.length > 100,
      { timeout: 15000 },
    );
  });

  test("React island mounts on /", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.length > 100 &&
        (document.body.innerText.includes("Organize your game") || !!document.querySelector("input[name='title']")),
      { timeout: 15000 },
    );
  });
});
