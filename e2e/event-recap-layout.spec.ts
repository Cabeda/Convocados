import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Layout claims jsdom cannot prove: where things are on a phone-sized screen.
 * Each one failed in review with the unit tests green.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../e2e-test.db");
const sql = (statement: string) => execSync(`sqlite3 "${DB_PATH}" "${statement}"`, { stdio: "pipe" });

// A random start: a failed test restarts the worker, and a reused address would trip the per-minute write limit.
let ipCounter = Math.floor(Math.random() * 60_000);
const uniqueIp = () => { ipCounter++; return `10.77.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`; };

function withIp(request: APIRequestContext, ip: string) {
  const headers = { "X-Forwarded-For": ip };
  return {
    post: (url: string, opts?: object) => request.post(url, { ...opts, headers: { ...headers, ...(opts as { headers?: object })?.headers } }),
    put: (url: string, opts?: object) => request.put(url, { ...opts, headers: { ...headers, ...(opts as { headers?: object })?.headers } }),
    get: (url: string) => request.get(url, { headers }),
  };
}

/** A finished game the signed-in viewer played in: 16 players, one of them is the viewer. */
async function finishedGame(page: Page, opts: { score: boolean; name: string; cost?: boolean }) {
  const request = page.context().request;
  const ip = uniqueIp();
  const api = withIp(request, ip);
  const email = `e2e-layout-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  await request.post("/api/auth/sign-up/email", { data: { email, password: "TestPassword123!", name: opts.name }, headers: { "X-Forwarded-For": ip } });
  sql(`UPDATE User SET emailVerified = 1 WHERE email = '${email}'`);
  const signIn = await request.post("/api/auth/sign-in/email", { data: { email, password: "TestPassword123!" }, headers: { "X-Forwarded-For": ip } });
  expect(signIn.status()).toBe(200);

  const create = await api.post("/api/events", {
    data: { title: "Layout game", location: "Test Stadium", dateTime: new Date(Date.now() + 86_400_000).toISOString(), maxPlayers: 16, sport: "football-5v5" },
  });
  const { id: eventId } = await create.json();
  const names = [opts.name, ...Array.from({ length: 15 }, (_, i) => `Player ${String.fromCharCode(65 + i)}`)];
  for (const name of names) await api.post(`/api/events/${eventId}/players`, { data: { name, linkToAccount: name === opts.name } });
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 3001);
  await api.post(`/api/events/${eventId}/randomize`, { headers: { Origin: `http://localhost:${port}` } });
  const eventRes = await api.get(`/api/events/${eventId}`);
  expect(eventRes.status(), "the event is readable").toBe(200);
  const data = await eventRes.json();
  const teamsSnapshot = data.teamResults.map((tr: { name: string; members: { name: string; order: number }[] }) => ({
    team: tr.name, players: tr.members.map((m) => ({ name: m.name, order: m.order })),
  }));
  const ended = new Date(Date.now() - 2 * 3_600_000).toISOString();
  await api.put(`/api/events/${eventId}/datetime`, { data: { dateTime: ended, timezone: "UTC" } });
  const history = await api.post(`/api/events/${eventId}/history`, {
    data: {
      dateTime: ended, teamOneName: data.teamOneName, teamTwoName: data.teamTwoName, teamsSnapshot,
      ...(opts.score ? { scoreOne: 3, scoreTwo: 2 } : {}),
    },
  });
  expect(history.status()).toBe(201);
  if (opts.cost) expect((await api.put(`/api/events/${eventId}/cost`, { data: { totalAmount: 80, currency: "EUR" } })).status()).toBe(200);
  return eventId as string;
}

const inView = async (page: Page, locator: ReturnType<Page["locator"]>) => {
  const box = await locator.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box, "element has a box").not.toBeNull();
  return box!.y >= 0 && box!.y + box!.height <= vh;
};

test.describe("Recap layout on a phone (390 x 667)", () => {
  test.use({ viewport: { width: 390, height: 667 }, hasTouch: true, isMobile: true });
  test.setTimeout(60_000);

  test("Confirm vote is in the viewport after picking a name", async ({ page }) => {
    const eventId = await finishedGame(page, { score: true, name: "Layout Viewer" });
    await page.goto(`/events/${eventId}`);
    await page.getByRole("button", { name: /^Vote/ }).first().click();
    const radios = page.getByRole("radio");
    await expect(radios.first()).toBeVisible();
    // A keyboard or thumb pick of the name already in view: the page does not scroll for it.
    await expect(radios.first()).toBeFocused();
    await page.keyboard.press("Space");
    await expect(radios.first()).toBeChecked();
    const confirm = page.getByRole("button", { name: "Confirm vote" });
    await expect(confirm).toBeEnabled();
    await expect.poll(() => inView(page, confirm), { message: "Confirm vote is inside the viewport", timeout: 3000 }).toBe(true);
  });

  test("after voting, the confirmation is on screen where the vote row was", async ({ page }) => {
    const eventId = await finishedGame(page, { score: true, name: "Layout Voter" });
    await page.goto(`/events/${eventId}`);
    await page.getByRole("button", { name: /^Vote/ }).first().click();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Confirm vote" }).click();
    const line = page.getByTestId("recap-live");
    await expect(line).toContainText("You voted for");
    await expect(line).toBeFocused();
    await expect.poll(() => inView(page, line), { message: "the confirmation line is inside the viewport", timeout: 3000 }).toBe(true);
    // The card did not shrink past the line: its heading is not scrolled out of the page above it.
    const card = await page.getByTestId("last-game-recap").boundingBox();
    expect(card!.y + card!.height).toBeGreaterThan(0);
  });

  for (const lang of ["de", "pt", "fr", "es", "it"]) {
    for (const width of [320, 390]) {
      test(`${lang} at ${width}px: the eyebrow clears the scoreboard, the link tiles line up, nothing scrolls sideways`, async ({ page }) => {
        await page.setViewportSize({ width, height: 700 });
        await page.addInitScript((l) => localStorage.setItem("convocados-locale", l), lang);
        const eventId = await finishedGame(page, { score: true, name: "Layout Viewer", cost: true });
        await page.goto(`/events/${eventId}`);
        const heading = page.locator("#recap-heading");
        await expect(heading).toBeVisible();
        const eyebrow = (await heading.boundingBox())!;
        const board = (await page.getByTestId("score-one").boundingBox())!;
        const names = (await page.getByTestId("last-game-recap").locator("p").first().boundingBox())!;
        expect(eyebrow.y + eyebrow.height, "eyebrow ends above the team names").toBeLessThanOrEqual(Math.min(board.y, names.y) + 1);
        // The three tiles: same top, same height, and their label rows start at the same y.
        const tiles = await page.getByTestId("last-game-recap").locator("a[href$='/history'], a[href$='/payments'], a[href$='/rankings']").evaluateAll((els) =>
          els.map((el) => ({ top: el.getBoundingClientRect().top, h: el.getBoundingClientRect().height, label: (el.children[1] as HTMLElement).getBoundingClientRect().top })));
        expect(tiles).toHaveLength(3);
        for (const tile of tiles) {
          expect(Math.abs(tile.top - tiles[0].top)).toBeLessThan(1);
          expect(Math.abs(tile.h - tiles[0].h)).toBeLessThan(1);
          expect(Math.abs(tile.label - tiles[0].label)).toBeLessThan(1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      });
    }
  }
});

test.describe("App bar when signed out", () => {
  test.setTimeout(60_000);

  for (const width of [320, 360, 390]) {
    test(`at ${width}px "Sign in" stays on one line and the bar does not overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      const api = withIp(page.context().request, uniqueIp());
      const created = await api.post("/api/events", {
        data: { title: "Bar game", location: "Test Stadium", dateTime: new Date(Date.now() + 86_400_000).toISOString(), maxPlayers: 10, sport: "football-5v5" },
      });
      const { id } = await created.json();
      await page.goto(`/events/${id}`);
      const signIn = page.locator("header").first().getByRole("button", { name: "Sign in", exact: true });
      await expect(signIn).toBeVisible();
      const box = (await signIn.boundingBox())!;
      expect(box.height, "one line of text, not two").toBeLessThan(50);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      // The preferences (language, dark mode) stay reachable: the gear is still there.
      await expect(page.locator("header").first().getByRole("button", { name: "Preferences" })).toBeVisible();
    });
  }
});

test.describe("Accessibility settings", () => {
  test.setTimeout(60_000);

  test("200% text at 320px: a long title is shown whole, nothing is clipped, nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.addInitScript(() => { document.documentElement.style.fontSize = "200%"; });
    const api = withIp(page.context().request, uniqueIp());
    const title = "Thursday night five-a-side at the old school pitch behind the market";
    const created = await api.post("/api/events", {
      data: { title, location: "Test Stadium", dateTime: new Date(Date.now() + 86_400_000).toISOString(), maxPlayers: 10, sport: "football-5v5" },
    });
    const { id } = await created.json();
    await page.goto(`/events/${id}`);
    await expect(page.locator("[data-ssr-event-summary]")).toHaveCount(0);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText(title);
    const clipped = await h1.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(clipped, "the title is cut off").toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test("at normal size the same title stops at three lines", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    const api = withIp(page.context().request, uniqueIp());
    const created = await api.post("/api/events", {
      data: { title: "Thursday night five-a-side at the old school pitch behind the market with the long name", location: "Test Stadium", dateTime: new Date(Date.now() + 86_400_000).toISOString(), maxPlayers: 10, sport: "football-5v5" },
    });
    const { id } = await created.json();
    await page.goto(`/events/${id}`);
    // The server's read-only summary has its own heading until the page takes over.
    await expect(page.locator("[data-ssr-event-summary]")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Thursday night");
    const m = await page.getByRole("heading", { level: 1 }).evaluate((el) => ({ h: el.getBoundingClientRect().height, fs: getComputedStyle(el).fontSize, sh: el.scrollHeight }));
    const lines = Math.round(m.h / (parseFloat(m.fs) * 1.15));
    expect(lines, JSON.stringify(m)).toBeLessThanOrEqual(3);
    expect(m.sh, "the rest of the title is cut off, not shown").toBeGreaterThan(m.h);
  });

  test("forced colors: filled slots keep a 2px outline in the text colour, and yours is the system highlight", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    const eventId = await finishedGameFuture(page, "Forced Viewer");
    await page.goto(`/events/${eventId}`);
    const slots = page.getByTestId("lineup-slots");
    await expect(slots).toBeVisible();
    const probe = async (css: string) => page.evaluate((c) => { const d = document.createElement("div"); d.style.cssText = c; document.body.appendChild(d); const v = getComputedStyle(d); const out = { bg: v.backgroundColor, color: v.color }; d.remove(); return out; }, css);
    const canvasText = (await probe("color: CanvasText")).color;
    const highlight = (await probe("background-color: Highlight")).bg;
    const other = await page.getByTestId("slot").first().evaluate((el) => { const v = getComputedStyle(el); return { w: v.borderTopWidth, c: v.borderTopColor, style: v.borderTopStyle }; });
    expect(other).toEqual({ w: "2px", c: canvasText, style: "solid" });
    const mine = await page.getByTestId("slot-me").evaluate((el) => { const v = getComputedStyle(el); return { w: v.borderTopWidth, bg: v.backgroundColor }; });
    expect(mine.w).toBe("2px");
    expect(mine.bg).toBe(highlight);
  });
});

/** A game that has not been played yet, 6 of 10 places taken, with the signed-in viewer on the list. */
async function finishedGameFuture(page: Page, name: string) {
  const request = page.context().request;
  const ip = uniqueIp();
  const api = withIp(request, ip);
  const email = `e2e-slots-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  await request.post("/api/auth/sign-up/email", { data: { email, password: "TestPassword123!", name }, headers: { "X-Forwarded-For": ip } });
  sql(`UPDATE User SET emailVerified = 1 WHERE email = '${email}'`);
  await request.post("/api/auth/sign-in/email", { data: { email, password: "TestPassword123!" }, headers: { "X-Forwarded-For": ip } });
  const created = await api.post("/api/events", {
    data: { title: "Slots game", location: "Test Stadium", dateTime: new Date(Date.now() + 2 * 86_400_000).toISOString(), maxPlayers: 10, sport: "football-5v5" },
  });
  const { id } = await created.json();
  for (const n of [name, "Ana Maria", "Beto Santos", "Carla Dias"]) await api.post(`/api/events/${id}/players`, { data: { name: n, linkToAccount: n === name } });
  return id as string;
}
