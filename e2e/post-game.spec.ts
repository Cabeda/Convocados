import { test, expect, type APIRequestContext } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../e2e-test.db");

/** Run a SQL statement against the E2E test database */
function sql(statement: string) {
  execSync(`sqlite3 "${DB_PATH}" "${statement}"`, { stdio: "pipe" });
}

/**
 * Generate a unique fake IP per test to avoid sharing rate limit budgets
 * with other E2E tests that run before us.
 */
let ipCounter = 0;
function uniqueIp(): string {
  ipCounter++;
  return `10.99.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
}

/** Wrap request methods to include a unique IP header to avoid rate limiting */
function withIp(request: APIRequestContext, ip: string) {
  const headers = { "X-Forwarded-For": ip };
  return {
    post: (url: string, opts?: any) =>
      request.post(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
    put: (url: string, opts?: any) =>
      request.put(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
    get: (url: string, opts?: any) =>
      request.get(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
    patch: (url: string, opts?: any) =>
      request.patch(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
  };
}

/** Sign up a user and verify their email directly in the DB */
async function createVerifiedUser(
  request: APIRequestContext,
  email: string,
  password: string,
  name: string,
): Promise<string> {
  // Sign up via better-auth API
  await request.post("/api/auth/sign-up/email", {
    data: { email, password, name },
  });

  // Verify email directly in the DB (bypass email verification)
  sql(`UPDATE User SET emailVerified = 1 WHERE email = '${email}'`);

  // Sign in to get session cookie
  const signInRes = await request.post("/api/auth/sign-in/email", {
    data: { email, password },
  });
  expect(signInRes.status()).toBe(200);

  // Get user ID from DB
  const userIdOutput = execSync(
    `sqlite3 "${DB_PATH}" "SELECT id FROM User WHERE email = '${email}'"`,
    { encoding: "utf-8" },
  ).trim();

  return userIdOutput;
}

/**
 * E2E test for the post-game experience (#249).
 *
 * Full lifecycle:
 * 1. Create user, sign in
 * 2. Create event (owned by user) with future date
 * 3. Add players
 * 4. Move event to the past (simulate time passing)
 * 5. Verify post-game banner appears
 * 6. Set up cost/payments
 * 7. Verify banner shows both tasks pending
 * 8. Add score via history API (authenticated)
 * 9. Verify banner shows score done, payments pending
 * 10. Mark all payments as paid
 * 11. Verify banner disappears
 */
test.describe("Post-game experience — banner, score, payments", () => {
  test.setTimeout(60_000);

  test("full post-game lifecycle with auth", async ({ page, request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    // ── Step 1: Create and authenticate a user ──
    const email = `e2e-postgame-${Date.now()}@test.com`;
    const password = "TestPassword123!";
    const userName = "E2E Tester";

    const userId = await createVerifiedUser(request, email, password, userName);
    expect(userId).toBeTruthy();

    // ── Step 2: Create event (will be owned by authenticated user) ──
    const futureDate = new Date(Date.now() + 86400_000);
    const createRes = await api.post("/api/events", {
      data: {
        title: "E2E Post-Game Full Test",
        location: "Test Stadium",
        dateTime: futureDate.toISOString(),
        maxPlayers: 4,
        sport: "football-5v5",
      },
    });
    expect(createRes.status()).toBe(200);
    const { id: eventId } = await createRes.json();

    // ── Step 3: Add 4 players ──
    const players = ["Alice", "Bob", "Charlie", "Diana"];
    for (const name of players) {
      const res = await api.post(`/api/events/${eventId}/players`, {
        data: { name },
      });
      expect(res.status()).toBe(200);
    }

    // ── Step 4: Randomize teams (needed for history snapshot) ──
    const randomizeRes = await api.post(`/api/events/${eventId}/randomize`, {
      headers: { Origin: "http://localhost:3001", "X-Forwarded-For": ip },
    });
    expect(randomizeRes.status()).toBe(200);

    // Get team data for history creation
    const eventRes = await api.get(`/api/events/${eventId}`);
    const eventData = await eventRes.json();
    const teamsSnapshot = eventData.teamResults.map((tr: any) => ({
      team: tr.name,
      players: tr.members.map((m: any) => ({ name: m.name, order: m.order })),
    }));

    // ── Step 5: Move event to the past (2 hours ago) ──
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const dtRes = await api.put(`/api/events/${eventId}/datetime`, {
      data: { dateTime: twoHoursAgo.toISOString(), timezone: "UTC" },
    });
    expect(dtRes.status()).toBe(200);

    // ── Step 6: Verify post-game-status API ──
    const statusRes1 = await api.get(`/api/events/${eventId}/post-game-status`);
    const status1 = await statusRes1.json();
    expect(status1.gameEnded).toBe(true);
    expect(status1.hasScore).toBe(false);
    expect(status1.allPaid).toBe(true); // no cost yet
    expect(status1.allComplete).toBe(false);

    // ── Step 7: Visit event page — banner should be visible ──
    await page.goto(`/events/${eventId}`);
    await expect(page.locator('[data-testid="post-game-banner"]')).toBeVisible({
      timeout: 10_000,
    });

    // ── Step 8: Set up cost and payments ──
    const costRes = await api.put(`/api/events/${eventId}/cost`, {
      data: { totalAmount: 40, currency: "EUR" },
    });
    expect(costRes.status()).toBe(200);

    // Verify payments created
    const paymentsRes = await api.get(`/api/events/${eventId}/payments`);
    const paymentsData = await paymentsRes.json();
    expect(paymentsData.payments.length).toBe(4);
    expect(paymentsData.summary.pendingCount).toBe(4);

    // ── Step 9: Verify banner still visible (both tasks pending) ──
    await page.reload();
    await expect(page.locator('[data-testid="post-game-banner"]')).toBeVisible({
      timeout: 10_000,
    });

    // ── Step 10: Add score via history API (authenticated) ──
    const historyRes = await api.post(`/api/events/${eventId}/history`, {
      data: {
        dateTime: twoHoursAgo.toISOString(),
        teamOneName: eventData.teamOneName,
        teamTwoName: eventData.teamTwoName,
        scoreOne: 3,
        scoreTwo: 2,
        teamsSnapshot,
      },
    });
    expect(historyRes.status()).toBe(201);

    // Verify score is recorded
    const statusRes2 = await api.get(`/api/events/${eventId}/post-game-status`);
    const status2 = await statusRes2.json();
    expect(status2.hasScore).toBe(true);
    expect(status2.allPaid).toBe(false); // payments still pending
    expect(status2.allComplete).toBe(false);

    // ── Step 11: Reload — banner should show score done, payments pending ──
    await page.reload();
    await expect(page.locator('[data-testid="post-game-banner"]')).toBeVisible({
      timeout: 10_000,
    });

    // ── Step 12: Mark all payments as paid ──
    for (const name of players) {
      const payRes = await api.put(`/api/events/${eventId}/payments`, {
        data: { playerName: name, status: "paid", method: "cash" },
      });
      expect(payRes.status()).toBe(200);
    }

    // Verify all complete
    const statusRes3 = await api.get(`/api/events/${eventId}/post-game-status`);
    const status3 = await statusRes3.json();
    expect(status3.hasScore).toBe(true);
    expect(status3.allPaid).toBe(true);
    expect(status3.allComplete).toBe(true);

    // ── Step 13: Reload — banner should be GONE ──
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="post-game-banner"]')).not.toBeVisible({
      timeout: 10_000,
    });
  });

  test("post-game banner does NOT appear for future events", async ({ page, request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    const futureDate = new Date(Date.now() + 86400_000);
    const createRes = await api.post("/api/events", {
      data: {
        title: "E2E Future Game",
        location: "Test Field",
        dateTime: futureDate.toISOString(),
        maxPlayers: 4,
        sport: "football-5v5",
      },
    });
    expect(createRes.status()).toBe(200);
    const { id } = await createRes.json();

    await page.goto(`/events/${id}`);
    await expect(page.locator("text=E2E Future Game")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="post-game-banner"]')).not.toBeVisible();
  });

  test("post-game-status API returns correct states through lifecycle", async ({ request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    // Create event with future date
    const futureDate = new Date(Date.now() + 86400_000);
    const createRes = await api.post("/api/events", {
      data: {
        title: "E2E Status API Test",
        location: "Test Field",
        dateTime: futureDate.toISOString(),
        maxPlayers: 4,
        sport: "football-5v5",
      },
    });
    expect(createRes.status()).toBe(200);
    const { id } = await createRes.json();

    // Future event — gameEnded=false
    const res1 = await api.get(`/api/events/${id}/post-game-status`);
    const s1 = await res1.json();
    expect(s1.gameEnded).toBe(false);
    expect(s1.hasScore).toBe(false);
    expect(s1.allPaid).toBe(true);
    expect(s1.allComplete).toBe(false);

    // Move to past
    const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await api.put(`/api/events/${id}/datetime`, {
      data: { dateTime: pastDate.toISOString(), timezone: "UTC" },
    });

    // Past event — gameEnded=true
    const res2 = await api.get(`/api/events/${id}/post-game-status`);
    const s2 = await res2.json();
    expect(s2.gameEnded).toBe(true);
    expect(s2.allPaid).toBe(true);
    expect(s2.allComplete).toBe(false);

    // Add players and cost
    for (const name of ["P1", "P2"]) {
      await api.post(`/api/events/${id}/players`, { data: { name } });
    }
    await api.put(`/api/events/${id}/cost`, {
      data: { totalAmount: 20, currency: "EUR" },
    });

    // allPaid=false (pending payments)
    const res3 = await api.get(`/api/events/${id}/post-game-status`);
    const s3 = await res3.json();
    expect(s3.allPaid).toBe(false);

    // Mark all as paid
    for (const name of ["P1", "P2"]) {
      await api.put(`/api/events/${id}/payments`, {
        data: { playerName: name, status: "paid" },
      });
    }

    const res4 = await api.get(`/api/events/${id}/post-game-status`);
    const s4 = await res4.json();
    expect(s4.allPaid).toBe(true);
    expect(s4.allComplete).toBe(false); // still no score
  });
});
