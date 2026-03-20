import { test, expect } from "@playwright/test";

test.describe("Event lifecycle — create, add players, randomize", () => {
  let eventUrl: string;

  test("create event via API", async ({ request }) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(20, 0, 0, 0);

    const res = await request.post("/api/events", {
      data: {
        title: "E2E Lifecycle Game",
        location: "Test Field",
        dateTime: tomorrow.toISOString(),
        maxPlayers: 10,
        sport: "football-5v5",
      },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.id).toBeTruthy();
    eventUrl = `/events/${body.id}`;

    // Store for subsequent tests
    test.info().annotations.push({ type: "eventId", description: body.id });
  });

  test("event page loads and shows title", async ({ page, request }) => {
    // Create a fresh event for this test
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(20, 0, 0, 0);

    const res = await request.post("/api/events", {
      data: {
        title: "E2E Page Load Game",
        location: "Test Field",
        dateTime: tomorrow.toISOString(),
        maxPlayers: 10,
        sport: "football-5v5",
      },
    });
    const { id } = await res.json();

    await page.goto(`/events/${id}`);
    await expect(page).toHaveTitle(/E2E Page Load Game/);
  });

  test("add players via API and verify on page", async ({ page, request }) => {
    // Create event
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(20, 0, 0, 0);

    const createRes = await request.post("/api/events", {
      data: {
        title: "E2E Player Test",
        dateTime: tomorrow.toISOString(),
        maxPlayers: 4,
        sport: "football-5v5",
      },
    });
    const { id } = await createRes.json();

    // Add 4 players
    const players = ["Alice", "Bob", "Charlie", "Diana"];
    for (const name of players) {
      const res = await request.post(`/api/events/${id}/players`, {
        data: { name },
      });
      expect(res.status()).toBe(200);
    }

    // Load event page and verify players are visible
    await page.goto(`/events/${id}`);
    for (const name of players) {
      await expect(page.locator(`text=${name}`).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test("randomize teams via API", async ({ request }) => {
    // Create event + add players
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(20, 0, 0, 0);

    const createRes = await request.post("/api/events", {
      data: {
        title: "E2E Randomize Test",
        dateTime: tomorrow.toISOString(),
        maxPlayers: 4,
        sport: "football-5v5",
      },
    });
    const { id } = await createRes.json();

    for (const name of ["Alice", "Bob", "Charlie", "Diana"]) {
      const r = await request.post(`/api/events/${id}/players`, { data: { name } });
      expect(r.status()).toBe(200);
    }

    // Randomize — include Origin header for Astro CSRF check
    const res = await request.post(`/api/events/${id}/randomize`, {
      headers: { Origin: "http://localhost:3001" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("duplicate player name returns 409", async ({ request }) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(20, 0, 0, 0);

    const createRes = await request.post("/api/events", {
      data: {
        title: "E2E Duplicate Test",
        dateTime: tomorrow.toISOString(),
        maxPlayers: 10,
        sport: "football-5v5",
      },
    });
    const { id } = await createRes.json();

    // Add player
    const res1 = await request.post(`/api/events/${id}/players`, {
      data: { name: "Alice" },
    });
    expect(res1.status()).toBe(200);

    // Add same player again
    const res2 = await request.post(`/api/events/${id}/players`, {
      data: { name: "Alice" },
    });
    expect(res2.status()).toBe(409);
  });

  test("non-existent event returns 404", async ({ request }) => {
    const res = await request.post("/api/events/non-existent-id/players", {
      data: { name: "Ghost" },
    });
    expect(res.status()).toBe(404);
  });
});
