import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../e2e-test.db");

function sql(statement: string) {
  execSync(`sqlite3 "${DB_PATH}" <<< ${JSON.stringify(statement)}`, { stdio: "pipe" });
}

let ipCounter = 200;
function uniqueIp(): string {
  ipCounter++;
  return `10.55.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
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
    delete: (url: string, opts?: any) =>
      request.delete(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
  };
}

async function createEvent(request: APIRequestContext, title: string): Promise<string> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(20, 0, 0, 0);
  const res = await request.post("/api/events", {
    data: {
      title,
      location: "E2E Test Field",
      dateTime: tomorrow.toISOString(),
      maxPlayers: 10,
      sport: "football-5v5",
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.id;
}

async function getRoster(request: APIRequestContext, eventId: string): Promise<string[]> {
  const res = await request.get(`/api/events/${eventId}`);
  expect(res.status()).toBe(200);
  const data = await res.json();
  return (data.players as Array<{ name: string }>).map((p) => p.name);
}

async function addPlayerViaApi(
  request: APIRequestContext,
  eventId: string,
  name: string,
): Promise<void> {
  const r = withIp(request, uniqueIp());
  const res = await r.post(`/api/events/${eventId}/players`, { data: { name } });
  expect(res.status()).toBe(200);
}

async function removePlayerViaApi(
  request: APIRequestContext,
  eventId: string,
  playerId: string,
): Promise<void> {
  const r = withIp(request, uniqueIp());
  const res = await r.delete(`/api/events/${eventId}/players`, { data: { playerId } });
  expect(res.status()).toBe(200);
}

async function getPlayerId(
  request: APIRequestContext,
  eventId: string,
  name: string,
): Promise<string> {
  const res = await request.get(`/api/events/${eventId}`);
  const data = await res.json();
  const player = (data.players as Array<{ id: string; name: string }>).find(
    (p) => p.name === name,
  );
  if (!player) throw new Error(`Player ${name} not found in event ${eventId}`);
  return player.id;
}

async function addPlayerViaUi(page: Page, name: string): Promise<void> {
  // Type the name into the autocomplete and press Enter. This is the
  // no-dialog path: typing is itself a deliberate action.
  const input = page.getByPlaceholder(/add player/i);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await input.fill(name);
  await input.press("Enter");
  // No dialog should open on Enter.
  await expect(page.getByRole("dialog")).not.toBeVisible();
  // Wait for the player to appear on the roster and input to clear before
  // returning — prevents race when adding multiple players in sequence.
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(input).toHaveValue("", { timeout: 5_000 });
}

async function expectRosterContains(
  page: Page,
  request: APIRequestContext,
  eventId: string,
  name: string,
): Promise<void> {
  // DOM check
  await expect(page.getByText(name, { exact: true }).first())
    .toBeVisible({ timeout: 10_000 });
  // Server check (eventually consistent after optimistic UI)
  await expect.poll(async () => (await getRoster(request, eventId)).includes(name), {
    timeout: 5_000,
  }).toBe(true);
}

async function expectRosterOmits(
  page: Page,
  request: APIRequestContext,
  eventId: string,
  name: string,
): Promise<void> {
  await expect(page.getByText(name, { exact: true })).not.toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => !(await getRoster(request, eventId)).includes(name), {
    timeout: 5_000,
  }).toBe(true);
}

test.describe("Event page — add and remove players (issue #455)", () => {
  test("adds a specific player and confirms they are the one on the roster", async ({ page, request }) => {
    const eventId = await createEvent(request, "E2E Add Specific Game");
    const target = "SpecificAlpha";

    await page.goto(`/events/${eventId}`);
    await expect(page.getByText("E2E Add Specific Game")).toBeVisible();

    // Pre-condition: target is NOT on the roster.
    expect(await getRoster(request, eventId)).not.toContain(target);

    // Action: add the target via the typing+Enter path.
    await addPlayerViaUi(page, target);

    // Post-condition: target IS on the roster (DOM + server).
    await expectRosterContains(page, request, eventId, target);

    // Post-condition: no other player was added (only target).
    const roster = await getRoster(request, eventId);
    expect(roster).toEqual([target]);
  });

  test("removes a specific player and confirms they are the one removed", async ({ page, request }) => {
    const eventId = await createEvent(request, "E2E Remove Specific Game");
    const keep = "KeepBeta";
    const remove = "RemoveBeta";

    // Seed: two players on the roster.
    await addPlayerViaApi(request, eventId, keep);
    await addPlayerViaApi(request, eventId, remove);

    await page.goto(`/events/${eventId}`);
    await expectRosterContains(page, request, eventId, keep);
    await expectRosterContains(page, request, eventId, remove);

    // Pre-condition: both are on the roster.
    expect((await getRoster(request, eventId)).sort()).toEqual([keep, remove].sort());

    // Action: click the remove IconButton on the row for `remove`, then confirm in the dialog.
    const removeRow = page.locator(".MuiListItem-root", { hasText: remove }).first();
    await expect(removeRow).toBeVisible();
    await removeRow.locator("button").last().click();
    // The X button now opens a confirm-leave dialog (#469). Confirm the removal.
    await page.getByTestId("leave-dialog-confirm").click();

    // Post-condition: remove is gone, keep is still there (DOM + server).
    await expectRosterOmits(page, request, eventId, remove);
    await expectRosterContains(page, request, eventId, keep);

    // Post-condition: only keep is on the roster.
    const roster = await getRoster(request, eventId);
    expect(roster).toEqual([keep]);
  });

  test("adds multiple specific players and confirms all of them by name", async ({ page, request }) => {
    const eventId = await createEvent(request, "E2E Multi Specific Game");
    const targets = ["MultiOne", "MultiTwo", "MultiThree"];

    await page.goto(`/events/${eventId}`);

    for (const name of targets) {
      await addPlayerViaUi(page, name);
    }

    // All three must be on the roster (DOM + server).
    for (const name of targets) {
      await expectRosterContains(page, request, eventId, name);
    }

    // Roster matches the input set, in order, with no extras.
    const roster = await getRoster(request, eventId);
    expect(roster).toEqual(targets);
  });

  test("typing a name and pressing Enter adds the player without a dialog (self-initiated)", async ({ page, request }) => {
    const eventId = await createEvent(request, "E2E Typing No Dialog Game");
    const target = "TypingCharlie";

    await page.goto(`/events/${eventId}`);

    // Pre-condition: no dialog open.
    await expect(page.getByRole("dialog")).not.toBeVisible();

    await addPlayerViaUi(page, target);

    // Post-condition: no dialog opened during/after the Enter press.
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Post-condition: target is on the roster.
    await expectRosterContains(page, request, eventId, target);
  });
});
