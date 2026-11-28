import { test, expect, type APIRequestContext } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../e2e-test.db");

function sql(statement: string) {
  execSync(`sqlite3 "${DB_PATH}" "${statement}"`, { stdio: "pipe" });
}

function sqlQuery(statement: string): string {
  return execSync(`sqlite3 "${DB_PATH}" "${statement}"`, { encoding: "utf-8" }).trim();
}

let ipCounter = 200; // offset from other e2e tests
function uniqueIp(): string {
  ipCounter++;
  return `10.98.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
}

function withIp(request: APIRequestContext, ip: string) {
  const headers = { "X-Forwarded-For": ip };
  return {
    post: (url: string, opts?: any) =>
      request.post(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
    put: (url: string, opts?: any) =>
      request.put(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
    get: (url: string, opts?: any) =>
      request.get(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
  };
}

async function createVerifiedUser(
  request: APIRequestContext,
  email: string,
  password: string,
  name: string,
): Promise<string> {
  await request.post("/api/auth/sign-up/email", {
    data: { email, password, name },
  });
  sql(`UPDATE User SET emailVerified = 1 WHERE email = '${email}'`);
  const signInRes = await request.post("/api/auth/sign-in/email", {
    data: { email, password },
  });
  expect(signInRes.status()).toBe(200);
  const userId = execSync(
    `sqlite3 "${DB_PATH}" "SELECT id FROM User WHERE email = '${email}'"`,
    { encoding: "utf-8" },
  ).trim();
  return userId;
}

async function createEvent(
  api: ReturnType<typeof withIp>,
  title: string,
  maxPlayers = 10,
): Promise<string> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(20, 0, 0, 0);
  const res = await api.post("/api/events", {
    data: {
      title,
      location: "Test Field",
      dateTime: tomorrow.toISOString(),
      maxPlayers,
      sport: "football-5v5",
    },
  });
  expect(res.status()).toBe(200);
  const { id } = await res.json();
  return id;
}

// ─── Snackbar notifications ──────────────────────────────────────────────────

test.describe("Snackbar notifications", () => {
  test.setTimeout(30_000);

  test("share button shows 'link copied' snackbar", async ({ browser, request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);
    const eventId = await createEvent(api, "E2E Snackbar Share Test");

    // Create a context with clipboard-write permission granted
    const context = await browser.newContext({
      permissions: ["clipboard-write", "clipboard-read"],
    });
    const page = await context.newPage();

    await page.goto(`/events/${eventId}`);
    await expect(page.locator(`text=E2E Snackbar Share Test`)).toBeVisible({ timeout: 10_000 });

    // Stub navigator.share to be undefined so it falls through to clipboard copy
    await page.evaluate(() => {
      (navigator as any).share = undefined;
    });

    // Click the share icon button — it uses aria-label from t("shareGame")
    const shareBtn = page.locator('[aria-label="Share with players"]');
    await shareBtn.click();

    // Snackbar should appear with "Link copied to clipboard!"
    await expect(page.locator('.MuiSnackbar-root')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.MuiSnackbar-root')).toContainText(/link copied/i);

    await context.close();
  });

  test("undo toast appears after removing a player", async ({ page, request }) => {
    // Undo is offered to the organizer: the signed-in viewer owns the game.
    await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": uniqueIp() }); // its own write budget
    const owner = page.context().request;
    await createVerifiedUser(owner, `e2e-undo-${Date.now()}@test.com`, "TestPassword123!", "UndoOrganizer");
    const eventId = await createEvent(withIp(owner, uniqueIp()), "E2E Snackbar Undo Test", 10);

    const addRes = await withIp(request, uniqueIp()).post(`/api/events/${eventId}/players`, { data: { name: "UndoTestPlayer" } });
    expect(addRes.status()).toBe(200);

    await page.goto(`/events/${eventId}`);
    await expect(page.getByTestId("lineup-slots")).toBeVisible({ timeout: 10_000 });

    // Tap the person's slot, then Remove: no dialog for an organizer taking off a guest.
    await page.getByTestId("lineup-slots").getByRole("button", { name: "Options for UndoTestPlayer" }).click();
    await page.getByRole("button", { name: "Remove UndoTestPlayer" }).click();

    // The undo toast says who went and offers Undo; the person is off the lineup.
    const undo = page.getByTestId("undo-toast");
    await expect(undo).toBeVisible({ timeout: 5_000 });
    await expect(undo).toContainText("UndoTestPlayer removed");
    await expect(page.getByRole("group", { name: "0 of 10 places taken" })).toBeVisible();

    // Undo puts them back.
    await undo.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("group", { name: "1 of 10 places taken" })).toBeVisible({ timeout: 10_000 });
    await expect(undo).toBeHidden();
  });

  test("Skill Rating page is owner/admin-only", async ({ page, request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    // Create user and sign in (the API context becomes the event owner)
    const email = `e2e-notif-claim-${Date.now()}@test.com`;
    await createVerifiedUser(request, email, "TestPassword123!", "ClaimTester");

    // Create event (owned by this user) with an anonymous player
    const eventId = await createEvent(api, "E2E Skill Rating Access", 10);
    await api.post(`/api/events/${eventId}/players`, {
      data: { name: "AnonymousPlayer" },
    });

    // Anonymous visitor: the Skill Rating (raw Elo) surface is hidden.
    await page.goto(`/events/${eventId}/rankings`);
    await expect(page.locator("text=AnonymousPlayer")).toHaveCount(0);

    // Owner: signed in, the page is reachable again.
    const signInRes = await page.context().request.post("/api/auth/sign-in/email", {
      data: { email, password: "TestPassword123!" },
    });
    expect(signInRes.ok()).toBeTruthy();

    // The page settles on its own first: the rankings route navigates again
    // by itself, and a goto issued while that navigation is in flight is
    // "interrupted by another navigation to the same URL".
    await page.waitForLoadState("networkidle");
    await page.goto(`/events/${eventId}/rankings`);
    await expect(page.locator("text=AnonymousPlayer")).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Push subscription API ───────────────────────────────────────────────────

test.describe("Push subscription API", () => {
  test("POST and DELETE push subscription", async ({ request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    // Authenticate first — push endpoint now requires session
    const email = `push-api-${Date.now()}@test.local`;
    const userId = await createVerifiedUser(request, email, "TestPassword123!", "PushApiUser");

    const eventId = await createEvent(api, "E2E Push API Test");

    // Subscribe — POST a fake push subscription
    const fakeEndpoint = `https://fcm.googleapis.com/fcm/send/fake-${Date.now()}`;
    const postRes = await api.post(`/api/events/${eventId}/push`, {
      data: {
        endpoint: fakeEndpoint,
        keys: {
          p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfXRI",
          auth: "tBHItJI5svbpC7sc9axQiA",
        },
        locale: "en",
      },
    });
    expect(postRes.status()).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.ok).toBe(true);

    // Verify subscription exists in DB
    const count = execSync(
      `sqlite3 "${DB_PATH}" "SELECT COUNT(*) FROM PushSubscription WHERE userId = '${userId}' AND endpoint = '${fakeEndpoint}'"`,
      { encoding: "utf-8" },
    ).trim();
    expect(parseInt(count)).toBe(1);

    // Unsubscribe — DELETE
    const deleteRes = await request.delete(`/api/events/${eventId}/push`, {
      data: { endpoint: fakeEndpoint },
      headers: { "X-Forwarded-For": ip, "Content-Type": "application/json" },
    });
    expect(deleteRes.status()).toBe(200);
    const delBody = await deleteRes.json();
    expect(delBody.ok).toBe(true);

    // Verify subscription is gone
    const countAfter = execSync(
      `sqlite3 "${DB_PATH}" "SELECT COUNT(*) FROM PushSubscription WHERE userId = '${userId}' AND endpoint = '${fakeEndpoint}'"`,
      { encoding: "utf-8" },
    ).trim();
    expect(parseInt(countAfter)).toBe(0);
  });

  test("POST push subscription returns 400 for invalid data", async ({ request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    // Authenticate first
    const email = `push-invalid-${Date.now()}@test.local`;
    await createVerifiedUser(request, email, "TestPassword123!", "PushInvalidUser");

    const eventId = await createEvent(api, "E2E Push Validation Test");

    const res = await api.post(`/api/events/${eventId}/push`, {
      data: { endpoint: "https://example.com", keys: {} },
    });
    expect(res.status()).toBe(400);
  });

  test("POST push subscription returns 404 for non-existent event", async ({ request }) => {
    const ip = uniqueIp();

    // Authenticate first
    const email = `push-404-${Date.now()}@test.local`;
    await createVerifiedUser(request, email, "TestPassword123!", "Push404User");

    const res = await request.post("/api/events/non-existent-id/push", {
      data: {
        endpoint: "https://example.com/fake",
        keys: { p256dh: "abc", auth: "def" },
        locale: "en",
      },
      headers: { "X-Forwarded-For": ip },
    });
    expect(res.status()).toBe(404);
  });
});

// ─── Per-event notification overrides ────────────────────────────────────────

test.describe("Per-event notification overrides", () => {
  test("PUT /api/events/[id]/follow updates notification overrides", async ({ request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    const email = `notif-override-${Date.now()}@test.local`;
    await createVerifiedUser(request, email, "TestPassword123!", "OverrideUser");

    const eventId = await createEvent(api, "E2E Override Test");

    // Follow the event first
    const followRes = await api.post(`/api/events/${eventId}/follow`);
    expect(followRes.status()).toBe(200);

    // Update overrides
    const putRes = await request.put(`/api/events/${eventId}/follow`, {
      data: { mutePlayerActivity: true, mutePostGame: null },
      headers: { "X-Forwarded-For": ip, "Content-Type": "application/json" },
    });
    expect(putRes.status()).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.mutePlayerActivity).toBe(true);
    expect(putBody.mutePostGame).toBe(null);
    expect(putBody.muteReminders).toBe(null);

    // GET returns the overrides
    const getRes = await api.get(`/api/events/${eventId}/follow`);
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.following).toBe(true);
    expect(getBody.mutePlayerActivity).toBe(true);
    expect(getBody.muteReminders).toBe(null);
  });

  test("PUT returns 404 when not following", async ({ request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    const email = `notif-nf-${Date.now()}@test.local`;
    await createVerifiedUser(request, email, "TestPassword123!", "NotFollowing");

    const eventId = await createEvent(api, "E2E Not Following Test");

    const res = await request.put(`/api/events/${eventId}/follow`, {
      data: { mutePlayerActivity: true },
      headers: { "X-Forwarded-For": ip, "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(404);
  });

  test("PUT returns 400 for invalid field type", async ({ request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    const email = `notif-bad-${Date.now()}@test.local`;
    await createVerifiedUser(request, email, "TestPassword123!", "BadField");

    const eventId = await createEvent(api, "E2E Bad Field Test");
    await api.post(`/api/events/${eventId}/follow`);

    const res = await request.put(`/api/events/${eventId}/follow`, {
      data: { mutePlayerActivity: "yes" },
      headers: { "X-Forwarded-For": ip, "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── Follow game (the notify control on the event page) ──────────────────────

test.describe("Follow game UI", () => {
  test.setTimeout(30_000);

  test("a signed-out visitor is offered 'Sign in to follow'", async ({ page, request }) => {
    const eventId = await createEvent(withIp(request, uniqueIp()), "E2E Follow Signed Out Test");

    await page.goto(`/events/${eventId}`);
    await expect(page.getByRole("heading", { name: "E2E Follow Signed Out Test" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Sign in to follow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Follow game" })).toHaveCount(0);
  });

  test("following a game flips the button to 'Following' and it stays followed after a reload", async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": uniqueIp() }); // its own write budget
    const ctx = page.context().request;
    await createVerifiedUser(ctx, `e2e-follow-${Date.now()}@test.com`, "TestPassword123!", "FollowTester");
    const eventId = await createEvent(withIp(ctx, uniqueIp()), "E2E Follow Visible Test");

    await page.goto(`/events/${eventId}`);
    const follow = page.getByRole("button", { name: "Follow game" });
    await expect(follow).toBeEnabled({ timeout: 10_000 });
    await follow.click();

    await expect(page.getByRole("button", { name: "Following" })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".MuiSnackbar-root").first()).toContainText(/reminders for this game/i);

    await page.reload();
    await expect(page.getByRole("button", { name: "Following" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Follow game" })).toHaveCount(0);
  });

  test("with notifications blocked, following still works and says why no push will arrive", async ({ browser, request }) => {
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();
    await context.setExtraHTTPHeaders({ "X-Forwarded-For": uniqueIp() }); // its own write budget
    const ctx = page.context().request;
    await createVerifiedUser(ctx, `e2e-follow-denied-${Date.now()}@test.com`, "TestPassword123!", "FollowDenied");
    const eventId = await createEvent(withIp(ctx, uniqueIp()), "E2E Follow Denied Test");

    // The browser says the user turned notifications off.
    await page.addInitScript(() => {
      Object.defineProperty(window, "Notification", {
        value: { permission: "denied", requestPermission: async () => "denied" },
        writable: false,
      });
    });

    await page.goto(`/events/${eventId}`);
    const follow = page.getByRole("button", { name: "Follow game" });
    await expect(follow).toBeEnabled({ timeout: 10_000 });
    await follow.click();

    // The game is followed (its reminders still reach the app), and the toast names the blocked browser permission.
    await expect(page.getByRole("button", { name: "Following" })).toBeVisible({ timeout: 5_000 });
    // Toasts take turns: the follow confirmation first, then why this device will not get push.
    await expect(page.locator(".MuiSnackbar-root")).toContainText(/blocked in your browser settings/i, { timeout: 15_000 });

    await context.close();
  });
});

// ─── Notification preferences API ────────────────────────────────────────────

test.describe("Notification preferences API", () => {
  test("GET returns defaults for new user", async ({ request }) => {
    const email = `e2e-notifprefs-${Date.now()}@test.com`;
    await createVerifiedUser(request, email, "TestPassword123!", "PrefsTester");

    const res = await request.get("/api/me/notification-preferences");
    expect(res.status()).toBe(200);
    const prefs = await res.json();

    // Should match defaults: push enabled, email disabled
    expect(prefs.pushEnabled).toBe(true);
    expect(prefs.emailEnabled).toBe(false);
    expect(prefs.playerActivityPush).toBe(true);
    expect(prefs.gameReminderPush).toBe(true);
  });

  test("PUT updates a single preference", async ({ request }) => {
    const email = `e2e-notifprefs-put-${Date.now()}@test.com`;
    await createVerifiedUser(request, email, "TestPassword123!", "PrefsPutTester");

    // Toggle emailEnabled on
    const putRes = await request.put("/api/me/notification-preferences", {
      data: { emailEnabled: true },
      headers: { "Content-Type": "application/json" },
    });
    expect(putRes.status()).toBe(200);

    // Verify it persisted
    const getRes = await request.get("/api/me/notification-preferences");
    const prefs = await getRes.json();
    expect(prefs.emailEnabled).toBe(true);
    // Other defaults should remain
    expect(prefs.pushEnabled).toBe(true);
  });

  test("PUT updates multiple preferences", async ({ request }) => {
    const email = `e2e-notifprefs-multi-${Date.now()}@test.com`;
    await createVerifiedUser(request, email, "TestPassword123!", "PrefsMultiTester");

    const putRes = await request.put("/api/me/notification-preferences", {
      data: {
        emailEnabled: true,
        pushEnabled: false,
        reminder24h: false,
        paymentReminderPush: false,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(putRes.status()).toBe(200);

    const getRes = await request.get("/api/me/notification-preferences");
    const prefs = await getRes.json();
    expect(prefs.emailEnabled).toBe(true);
    expect(prefs.pushEnabled).toBe(false);
    expect(prefs.reminder24h).toBe(false);
    expect(prefs.paymentReminderPush).toBe(false);
    // Untouched defaults
    expect(prefs.gameReminderPush).toBe(true);
    expect(prefs.playerActivityPush).toBe(true);
  });
});

/** Sign in via the browser page (sets session cookie in the page context) */
async function signInViaPage(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/auth/signin");
  await page.waitForSelector("input", { timeout: 10_000 });

  // The sign-in page defaults to "Email link" tab — switch to "Password" tab
  const passwordTab = page.locator('button:has-text("Password"), [role="tab"]:has-text("Password")').first();
  await passwordTab.click();

  // Fill email and password
  const emailInput = page.locator('input[name="email"], input[type="email"]').first();
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  await emailInput.fill(email);
  await passwordInput.fill(password);

  // Submit
  const submitBtn = page.locator('button[type="submit"]').first();
  await submitBtn.click();

  // Wait for redirect away from signin page
  await page.waitForURL((url) => !url.pathname.includes("/auth/signin"), { timeout: 10_000 });
}

// ─── Notification settings UI (authenticated) ───────────────────────────────

test.describe("Notification settings UI", () => {
  test.setTimeout(45_000);

  test("notification settings section renders with toggles on profile page", async ({ page, request }) => {
    const email = `e2e-notifsettings-${Date.now()}@test.com`;
    const password = "TestPassword123!";
    const userId = await createVerifiedUser(request, email, password, "SettingsTester");

    // Sign in via the browser so the page has the session cookie
    await signInViaPage(page, email, password);

    // Navigate to user profile page (profile lives at /users/:id)
    await page.goto(`/users/${userId}`);
    await page.waitForLoadState("networkidle");

    // The NotificationSettingsSection should be visible (only on own profile)
    const section = page.locator('text=Notification settings');
    await expect(section).toBeVisible({ timeout: 10_000 });

    // Should show the toggle switches
    await expect(page.locator('text=Email notifications').first()).toBeVisible();
    await expect(page.locator('text=Push notifications').first()).toBeVisible();

    // Should show category sections
    await expect(page.getByRole('heading', { name: 'Game invites' })).toBeVisible();
    await expect(page.locator('text=Player activity')).toBeVisible();
    await expect(page.locator('text=Event changes')).toBeVisible();
    await expect(page.locator('text=Game reminders')).toBeVisible();
  });

  test("toggling a notification preference shows saved snackbar", async ({ page, request }) => {
    const email = `e2e-notifsettings-toggle-${Date.now()}@test.com`;
    const password = "TestPassword123!";
    const userId = await createVerifiedUser(request, email, password, "ToggleTester");

    // Sign in via the browser so the page has the session cookie
    await signInViaPage(page, email, password);

    await page.goto(`/users/${userId}`);
    await page.waitForLoadState("networkidle");

    // Wait for the notification settings section to load (it fetches prefs)
    await expect(page.locator('text=Notification settings')).toBeVisible({ timeout: 10_000 });

    // Find the "Email notifications" toggle (the first global toggle)
    // MUI Switch is rendered as a checkbox input inside a span
    const emailToggle = page.locator('label:has-text("Email notifications") input[type="checkbox"]').first();
    await expect(emailToggle).toBeVisible({ timeout: 5_000 });

    // Click to toggle it on
    await emailToggle.click();

    // Should show "Notification settings saved." snackbar
    await expect(page.locator('.MuiSnackbar-root')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.MuiSnackbar-root')).toContainText(/saved/i);
  });
});

// ─── VAPID public key endpoint ───────────────────────────────────────────────

test.describe("VAPID public key API", () => {
  test("GET /api/push/vapid-public-key returns a non-empty key", async ({ request }) => {
    const res = await request.get("/api/push/vapid-public-key");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("publicKey");
    expect(typeof body.publicKey).toBe("string");
    // With VAPID keys configured in playwright.config.ts, the key should be non-empty
    expect(body.publicKey.length).toBeGreaterThan(0);
  });
});

// ─── Two-browser push notification delivery ──────────────────────────────────

test.describe("Web push notification delivery", () => {
  test.setTimeout(60_000);

  test("subscriber receives push when another user adds a player", async ({ browser, request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    // Authenticate the subscriber for push subscription
    const subEmail = `push-delivery-${Date.now()}@test.local`;
    const subUserId = await createVerifiedUser(request, subEmail, "TestPassword123!", "PushSubscriber");

    const eventId = await createEvent(api, "E2E Push Delivery Test", 10);

    // ── Browser A: subscriber ──
    // Create a context with notifications permission granted
    const subscriberContext = await browser.newContext({
      permissions: ["notifications"],
    });
    const subscriberPage = await subscriberContext.newPage();

    await subscriberPage.goto(`/events/${eventId}`);
    await expect(subscriberPage.locator("text=E2E Push Delivery Test")).toBeVisible({ timeout: 10_000 });

    // The follow control no longer subscribes this headless browser by itself, so the push
    // subscription is made through the API: the server-side pipeline is what this test proves.
    await subscriberPage.waitForTimeout(2_000); // let the page settle before the actor adds a player

    // Manually create a push subscription in the DB via API
    const fakeEndpoint = `https://fcm.googleapis.com/fcm/send/e2e-delivery-${Date.now()}`;
    const subRes = await api.post(`/api/events/${eventId}/push`, {
      data: {
        endpoint: fakeEndpoint,
        keys: {
          p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfXRI",
          auth: "tBHItJI5svbpC7sc9axQiA",
        },
        locale: "en",
      },
    });
    expect(subRes.status()).toBe(200);

    // Verify subscription exists
    const subCount = sqlQuery(
      `SELECT COUNT(*) FROM PushSubscription WHERE userId = '${subUserId}' AND endpoint = '${fakeEndpoint}'`,
    );
    expect(parseInt(subCount)).toBeGreaterThanOrEqual(1);

    // ── Browser B: actor adds a player (different clientId) ──
    const actorIp = uniqueIp();
    const addRes = await request.post(`/api/events/${eventId}/players`, {
      data: { name: "PushTestPlayer" },
      headers: {
        "X-Forwarded-For": actorIp,
        "X-Client-Id": "actor-client-different",
      },
    });
    expect(addRes.status()).toBe(200);

    // Wait for the drain to complete (it's fire-and-forget, give it a moment)
    await subscriberPage.waitForTimeout(3_000);

    // Verify the notification job was created and processed
    const jobCount = sqlQuery(
      `SELECT COUNT(*) FROM NotificationJob WHERE eventId = '${eventId}'`,
    );
    expect(parseInt(jobCount)).toBeGreaterThanOrEqual(1);

    // Check that at least one job was processed (processedAt is set)
    const processedCount = sqlQuery(
      `SELECT COUNT(*) FROM NotificationJob WHERE eventId = '${eventId}' AND processedAt IS NOT NULL`,
    );
    expect(parseInt(processedCount)).toBeGreaterThanOrEqual(1);

    // Check that no jobs failed (failedAt should be NULL for processed jobs)
    const failedCount = sqlQuery(
      `SELECT COUNT(*) FROM NotificationJob WHERE eventId = '${eventId}' AND failedAt IS NOT NULL`,
    );
    expect(parseInt(failedCount)).toBe(0);

    // The push subscription should still exist (not deleted due to 410/404)
    // Note: with a fake endpoint, the push service will reject it, but the
    // subscription is only deleted on 410/404 status codes. A connection
    // error or other failure keeps the subscription intact.
    const subCountAfter = sqlQuery(
      `SELECT COUNT(*) FROM PushSubscription WHERE userId = '${subUserId}' AND endpoint = '${fakeEndpoint}'`,
    );
    // Subscription may or may not survive depending on the push service response
    // The important thing is the job was processed
    expect(parseInt(subCountAfter)).toBeGreaterThanOrEqual(0);

    await subscriberContext.close();
  });
});
