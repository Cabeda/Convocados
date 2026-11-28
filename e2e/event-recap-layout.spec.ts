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

let ipCounter = 200;
const uniqueIp = () => { ipCounter++; return `10.77.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`; };

function withIp(request: APIRequestContext, ip: string) {
  const headers = { "X-Forwarded-For": ip };
  return {
    post: (url: string, opts?: object) => request.post(url, { ...opts, headers: { ...headers, ...(opts as { headers?: object })?.headers } }),
    put: (url: string, opts?: object) => request.put(url, { ...opts, headers: { ...headers, ...(opts as { headers?: object })?.headers } }),
    get: (url: string) => request.get(url, { headers }),
  };
}

/** A finished game the signed-in viewer played in: 16 players, one of them is the viewer. */
async function finishedGame(page: Page, opts: { score: boolean; name: string }) {
  const request = page.context().request;
  const api = withIp(request, uniqueIp());
  const email = `e2e-layout-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  await request.post("/api/auth/sign-up/email", { data: { email, password: "TestPassword123!", name: opts.name } });
  sql(`UPDATE User SET emailVerified = 1 WHERE email = '${email}'`);
  const signIn = await request.post("/api/auth/sign-in/email", { data: { email, password: "TestPassword123!" } });
  expect(signIn.status()).toBe(200);

  const create = await api.post("/api/events", {
    data: { title: "Layout game", location: "Test Stadium", dateTime: new Date(Date.now() + 86_400_000).toISOString(), maxPlayers: 16, sport: "football-5v5" },
  });
  const { id: eventId } = await create.json();
  const names = [opts.name, ...Array.from({ length: 15 }, (_, i) => `Player ${String.fromCharCode(65 + i)}`)];
  for (const name of names) await api.post(`/api/events/${eventId}/players`, { data: { name, linkToAccount: name === opts.name } });
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 3001);
  await api.post(`/api/events/${eventId}/randomize`, { headers: { Origin: `http://localhost:${port}` } });
  const data = await (await api.get(`/api/events/${eventId}`)).json();
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
});
