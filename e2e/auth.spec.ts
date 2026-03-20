import { test, expect } from "@playwright/test";

test.describe("Auth pages", () => {
  test("should load the sign-in page", async ({ page }) => {
    await page.goto("/auth/signin");
    await expect(page).toHaveTitle(/Sign In/);
  });

  test("should load the sign-up page", async ({ page }) => {
    await page.goto("/auth/signup");
    await expect(page).toHaveTitle(/Sign Up|Convocados/);
  });

  test("should show form fields on sign-in page", async ({ page }) => {
    await page.goto("/auth/signin");
    // Wait for React to hydrate
    await page.waitForSelector("input", { timeout: 10_000 });
    const inputs = page.locator("input");
    expect(await inputs.count()).toBeGreaterThanOrEqual(1);
  });
});
