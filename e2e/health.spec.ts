import { test, expect } from "@playwright/test";

test.describe("Health API", () => {
  test("GET /api/health returns ok with WAL mode", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.db.writable).toBe(true);
    expect(body.db.journalMode).toBe("wal");
  });
});
