import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../e2e-test.db");

let ipCounter = Math.floor(Math.random() * 60_000);
const uniqueIp = () => { ipCounter++; return `10.66.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`; };

/** A signed-in browser session: the cookie lands on the page's context, so page.goto sends it. */
async function signIn(page: Page, name: string): Promise<APIRequestContext> {
  const ip = uniqueIp();
  // Its own address: the page's writes count against an IP's 30-a-minute budget, which the suite would otherwise share.
  await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": uniqueIp() });
  const ctx = page.context().request;
  const email = `e2e-life-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "TestPassword123!", name }, headers: { "X-Forwarded-For": ip } });
  execSync(`sqlite3 "${DB_PATH}" "UPDATE User SET emailVerified = 1 WHERE email = '${email}'"`, { stdio: "pipe" });
  const res = await ctx.post("/api/auth/sign-in/email", { data: { email, password: "TestPassword123!" }, headers: { "X-Forwarded-For": ip } });
  expect(res.status()).toBe(200);
  return ctx;
}

async function createGame(ctx: APIRequestContext, title: string, maxPlayers: number): Promise<string> {
  const when = new Date();
  when.setDate(when.getDate() + 1);
  when.setHours(20, 0, 0, 0);
  const res = await ctx.post("/api/events", {
    data: { title, location: "E2E Test Field", dateTime: when.toISOString(), maxPlayers, sport: "football-5v5" },
    headers: { "X-Forwarded-For": uniqueIp() },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).id as string;
}

async function roster(ctx: APIRequestContext, id: string) {
  const data = await (await ctx.get(`/api/events/${id}`)).json();
  return data as { players: Array<{ name: string; userId: string | null }>; teamResults: Array<{ name: string; members: Array<{ name: string }> }> };
}


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
    // Use a unique IP so this test doesn't share the per-IP event-create rate limit with
    // the other tests in this file (which all hit the same 127.0.0.1).
    const ip = `10.99.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
    const headers = { "X-Forwarded-For": ip };
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(20, 0, 0, 0);

    const createRes = await request.post("/api/events", {
      headers,
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
      headers,
      data: { name: "Alice" },
    });
    expect(res1.status()).toBe(200);

    // Add same player again
    const res2 = await request.post(`/api/events/${id}/players`, {
      headers,
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

test.describe("Event page — RSVP and teams through the UI", () => {
  test.setTimeout(60_000);

  test("a signed-in player taps I'm in, sees 'You're in', then changes their answer to Can't make it", async ({ page }) => {
    const ctx = await signIn(page, "Rsvp Rita");
    const id = await createGame(ctx, "E2E RSVP Game", 10);

    await page.goto(`/events/${id}`);
    const row = page.getByTestId("rsvp-row");
    await row.getByRole("button", { name: "I'm in" }).click();

    // The answer shows at once and the server has the viewer linked to their account.
    await expect(page.getByTestId("rsvp-status")).toHaveText("You're in", { timeout: 10_000 });
    await expect(page.getByRole("group", { name: "1 of 10 places taken" })).toBeVisible();
    await expect.poll(async () => (await roster(ctx, id)).players.map((p) => p.name)).toEqual(["Rsvp Rita"]);
    expect((await roster(ctx, id)).players[0].userId).not.toBeNull();

    // Changing the answer asks before giving the place up.
    await row.getByRole("button", { name: "Change my answer" }).click();
    await row.getByRole("button", { name: "Can't make it" }).click();
    await page.getByTestId("leave-dialog-confirm").click();

    await expect(page.getByTestId("rsvp-status")).toHaveText("You're out", { timeout: 10_000 });
    await expect.poll(async () => (await roster(ctx, id)).players.length).toBe(0);
  });

  test("a full list draws its own teams, and the organizer's 'Draw again' asks before replacing them", async ({ page }) => {
    const ctx = await signIn(page, "Draw Organizer");
    const id = await createGame(ctx, "E2E Draw Teams Game", 4);
    for (const name of ["Alice", "Bob", "Charlie", "Diana"]) {
      expect((await ctx.post(`/api/events/${id}/players`, { data: { name }, headers: { "X-Forwarded-For": uniqueIp() } })).status()).toBe(200);
    }
    const everyone = ["Alice", "Bob", "Charlie", "Diana"];

    // The fourth name fills the list, and the server draws the teams without anyone asking.
    await page.goto(`/events/${id}`);
    const teams = page.getByTestId("teams");
    await expect(page.getByTestId("team-col")).toHaveCount(2, { timeout: 10_000 });
    for (const name of everyone) await expect(page.getByTestId(`team-player-${name}`)).toBeVisible();
    await expect.poll(async () => (await roster(ctx, id)).teamResults.flatMap((t) => t.members.map((m) => m.name)).sort()).toEqual(everyone);

    // Teams exist: the organizer's button now reads "Draw again" and asks first. Cancel keeps what is there.
    await teams.getByRole("button", { name: "Draw again" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("team-col")).toHaveCount(2);

    // Confirming draws again: still two teams, still everybody, each on exactly one side.
    await teams.getByRole("button", { name: "Draw again" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Draw again" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId("team-col")).toHaveCount(2);
    for (const name of everyone) await expect(page.getByTestId(`team-player-${name}`)).toHaveCount(1);
    await expect.poll(async () => (await roster(ctx, id)).teamResults.flatMap((t) => t.members.map((m) => m.name)).sort()).toEqual(everyone);
  });

  test("drawing with a short list asks first, and says how many are in", async ({ page }) => {
    const ctx = await signIn(page, "Early Organizer");
    const id = await createGame(ctx, "E2E Early Draw Game", 10);
    for (const name of ["Eve", "Finn"]) {
      expect((await ctx.post(`/api/events/${id}/players`, { data: { name }, headers: { "X-Forwarded-For": uniqueIp() } })).status()).toBe(200);
    }

    await page.goto(`/events/${id}`);
    await page.getByTestId("teams").getByRole("button", { name: "Draw teams now" }).click();
    const dialog = page.getByRole("dialog", { name: "Draw teams now?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Draw teams" }).click();

    await expect(page.getByTestId("team-col")).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByTestId("teams-drawn-early")).toBeVisible();
  });
});
