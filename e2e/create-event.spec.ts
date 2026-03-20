import { test, expect } from "@playwright/test";

test.describe("Home page — Create Event", () => {
  test("should load the home page with create event form", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Convocados/);
    // The create event form should be visible
    await expect(page.locator("form")).toBeVisible();
  });

  test("should create an event and redirect to event page", async ({ page }) => {
    await page.goto("/");

    // Fill in the title
    const titleInput = page.locator('input[name="title"]');
    await titleInput.clear();
    await titleInput.fill("E2E Test Game");

    // Fill in the date (1 day from now)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(20, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:00`;
    const dateInput = page.locator('input[name="dateTime"]');
    await dateInput.fill(dateStr);

    // Submit the form
    await page.locator('button[type="submit"]').click();

    // Should redirect to the event page
    await page.waitForURL(/\/events\//, { timeout: 10_000 });
    await expect(page.locator("text=E2E Test Game")).toBeVisible();
  });
});
