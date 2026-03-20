import { test, expect } from "@playwright/test";

test.describe("Public Games page", () => {
  test("should load the public games page", async ({ page }) => {
    await page.goto("/public");
    await expect(page).toHaveTitle(/Public Games/);
  });

  test("GET /api/events/public returns paginated list", async ({ request }) => {
    const res = await request.get("/api/events/public");
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("hasMore");
    expect(Array.isArray(body.data)).toBe(true);
  });
});
