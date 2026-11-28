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

/**
 * Create an event. With a signed-in `request` (the page's own context) the viewer owns it; with the bare
 * `request` fixture the event has no owner, so everyone is its organizer.
 */
async function createEvent(request: APIRequestContext, title: string, maxPlayers = 10): Promise<string> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(20, 0, 0, 0);
  const res = await withIp(request, uniqueIp()).post("/api/events", {
    data: {
      title,
      location: "E2E Test Field",
      dateTime: tomorrow.toISOString(),
      maxPlayers,
      sport: "football-5v5",
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.id;
}

/**
 * Give this browser its own address. Every write the page makes (add, remove, follow) counts against its IP's
 * 30-a-minute budget, and without this the whole suite shares one: late tests then fail with "check your connection".
 */
async function ownIp(page: Page): Promise<void> {
  await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": uniqueIp() });
}

/** Sign a fresh user in on `ctx`; the cookie stays with that context. */
async function signInOn(ctx: APIRequestContext, name: string): Promise<void> {
  const ip = uniqueIp();
  const email = `e2e-add-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  await ctx.post("/api/auth/sign-up/email", {
    data: { email, password: "TestPassword123!", name },
    headers: { "X-Forwarded-For": ip },
  });
  sql(`UPDATE User SET emailVerified = 1 WHERE email = '${email}'`);
  const res = await ctx.post("/api/auth/sign-in/email", {
    data: { email, password: "TestPassword123!" },
    headers: { "X-Forwarded-For": ip },
  });
  expect(res.status()).toBe(200);
}

/** A signed-in browser session: the cookie lands on the page's context, so page.goto sends it. */
const signIn = async (page: Page, name: string) => { await ownIp(page); await signInOn(page.context().request, name); };

async function getRoster(request: APIRequestContext, eventId: string): Promise<string[]> {
  const res = await request.get(`/api/events/${eventId}`);
  expect(res.status()).toBe(200);
  const data = await res.json();
  return (data.players as Array<{ name: string }>).map((p) => p.name);
}

async function addPlayerViaApi(request: APIRequestContext, eventId: string, name: string): Promise<void> {
  const res = await withIp(request, uniqueIp()).post(`/api/events/${eventId}/players`, { data: { name } });
  expect(res.status()).toBe(200);
}

/** "Who's in" lists the names; it starts folded on a plain game, so open it when it is not already. */
async function openWhosIn(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Who's in" });
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(page.getByTestId("whos-in")).toBeVisible();
}

const whosIn = (page: Page) => page.getByTestId("whos-in");

/** Open "Add a friend" and add one name; the panel stays open for the next one. */
async function addFriendViaUi(page: Page, name: string): Promise<void> {
  const panel = page.getByRole("group", { name: "Add a friend" });
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Add a friend" }).click();
  const field = panel.getByRole("textbox", { name: "Their name or email" });
  await expect(field).toBeVisible({ timeout: 10_000 });
  await field.fill(name);
  await field.press("Enter");
  // The field empties once the server has taken the name, ready for the next one.
  await expect(field).toHaveValue("", { timeout: 10_000 });
}

async function expectRosterContains(page: Page, request: APIRequestContext, eventId: string, name: string) {
  await expect(whosIn(page).getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await getRoster(request, eventId)).includes(name), { timeout: 5_000 }).toBe(true);
}

async function expectRosterOmits(page: Page, request: APIRequestContext, eventId: string, name: string) {
  await expect(whosIn(page).getByText(name, { exact: true })).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () => !(await getRoster(request, eventId)).includes(name), { timeout: 5_000 }).toBe(true);
}

test.describe("Event page — add and remove players (issue #455)", () => {
  test("a signed-out visitor adds just their own name and is the one on the roster", async ({ page, request }) => {
    await ownIp(page);
    const eventId = await createEvent(request, "E2E Add Own Name Game");
    const target = "SpecificAlpha";

    await page.goto(`/events/${eventId}`);
    await expect(page.getByText("E2E Add Own Name Game").first()).toBeVisible();
    expect(await getRoster(request, eventId)).not.toContain(target);

    // No account: the quiet "Or add just your name" opens a one-field panel.
    await page.getByRole("button", { name: "Or add just your name" }).click();
    const panel = page.getByRole("group", { name: "Add your name" });
    await expect(panel).toBeVisible();
    // There is no Add / Invite / Share choice to make: one field, one button.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await panel.getByRole("textbox", { name: "Your name" }).fill(target);
    await panel.getByRole("button", { name: "Add me" }).click();

    // A visitor adds themselves once: the panel closes and the offer goes away.
    await expect(panel).toBeHidden({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Or add just your name" })).toHaveCount(0);
    await openWhosIn(page);
    await expectRosterContains(page, request, eventId, target);
    expect(await getRoster(request, eventId)).toEqual([target]);
    await expect(page.getByRole("group", { name: "1 of 10 places taken" })).toBeVisible();
  });

  test("a signed-in organizer adds friends one after another from the Add a friend panel", async ({ page, request }) => {
    await signIn(page, "Add Organizer");
    const eventId = await createEvent(page.context().request, "E2E Multi Specific Game");
    const targets = ["MultiOne", "MultiTwo", "MultiThree"];

    await page.goto(`/events/${eventId}`);
    for (const name of targets) await addFriendViaUi(page, name);
    // "Who's in" appears with the first name.
    await openWhosIn(page);

    // The panel stayed open for the next person, so the whole group went in without reopening it.
    await expect(page.getByRole("group", { name: "Add a friend" })).toBeVisible();
    for (const name of targets) await expectRosterContains(page, request, eventId, name);
    expect(await getRoster(request, eventId)).toEqual(targets);
    await expect(page.getByRole("group", { name: "3 of 10 places taken" })).toBeVisible();
  });

  test("typing a name and pressing Enter adds it straight away — no choice dialog, and an invite link is one tap away", async ({ page, request }) => {
    await signIn(page, "Typing Organizer");
    const eventId = await createEvent(page.context().request, "E2E Typing Panel Game");
    const target = "TypingCharlie";

    await page.goto(`/events/${eventId}`);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Add a friend" }).click();
    const panel = page.getByRole("group", { name: "Add a friend" });
    // The panel itself carries what the old Add-or-Invite dialog asked: add them, or send a link instead.
    await expect(panel.getByRole("button", { name: "Add to the game" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Send an invite link instead" })).toBeVisible();

    const field = panel.getByRole("textbox", { name: "Their name or email" });
    await field.fill(target);
    await field.press("Enter");

    // No dialog opened — a plain name has no contact channel to invite through — and the person is on the roster.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openWhosIn(page);
    await expectRosterContains(page, request, eventId, target);
  });

  test("'Send an invite link instead' makes a link for the typed name and does not put them on the roster", async ({ page, request }) => {
    await signIn(page, "Link Organizer");
    const eventId = await createEvent(page.context().request, "E2E Invite Link Game");
    const target = "LinkDelta";

    await page.goto(`/events/${eventId}`);
    await page.getByRole("button", { name: "Add a friend" }).click();
    const panel = page.getByRole("group", { name: "Add a friend" });
    await panel.getByRole("textbox", { name: "Their name or email" }).fill(target);
    await panel.getByRole("button", { name: "Send an invite link instead" }).click();

    // The share dialog carries the link to copy or send.
    const share = page.getByRole("dialog");
    await expect(share).toBeVisible({ timeout: 10_000 });
    await expect(share).toContainText(target);
    await expect(share.getByRole("button", { name: "Copy link" })).toBeVisible();
    await share.getByRole("button", { name: "Cancel" }).click();
    await expect(share).toBeHidden();

    // Invited is not "in": the roster is untouched.
    expect(await getRoster(request, eventId)).toEqual([]);
  });

  test("a signed-out visitor takes their own name off again from its slot", async ({ page, request }) => {
    await ownIp(page);
    const eventId = await createEvent(request, "E2E Visitor Remove Game");
    const mine = "VisitorEcho";

    await page.goto(`/events/${eventId}`);
    await page.getByRole("button", { name: "Or add just your name" }).click();
    await page.getByRole("textbox", { name: "Your name" }).fill(mine);
    await page.getByRole("button", { name: "Add me" }).click();
    await openWhosIn(page);
    await expectRosterContains(page, request, eventId, mine);

    // Their own slot opens its options; removing a name added from this browser needs no further question.
    await page.getByRole("button", { name: `Options for ${mine}` }).first().click();
    await page.getByRole("button", { name: `Remove ${mine}` }).click();

    await expectRosterOmits(page, request, eventId, mine);
    expect(await getRoster(request, eventId)).toEqual([]);
  });

  test("an organizer removes the right person from the lineup and can undo it", async ({ page, request }) => {
    await signIn(page, "Remove Organizer");
    const eventId = await createEvent(page.context().request, "E2E Remove Specific Game");
    const keep = "KeepBeta";
    const remove = "RemoveBeta";
    await addPlayerViaApi(request, eventId, keep);
    await addPlayerViaApi(request, eventId, remove);

    await page.goto(`/events/${eventId}`);
    await openWhosIn(page);
    await expectRosterContains(page, request, eventId, keep);
    await expectRosterContains(page, request, eventId, remove);
    expect((await getRoster(request, eventId)).sort()).toEqual([keep, remove].sort());

    // Tap the slot of the person to remove: its options open, with a Remove button named for them.
    await page.getByRole("button", { name: `Options for ${remove}` }).first().click();
    const options = page.getByRole("group", { name: `Options for ${remove}` });
    await expect(options).toBeVisible();
    await options.getByRole("button", { name: `Remove ${remove}` }).click();

    // Only that person is gone (DOM + server), and the toast says who and offers Undo.
    await expectRosterOmits(page, request, eventId, remove);
    await expectRosterContains(page, request, eventId, keep);
    expect(await getRoster(request, eventId)).toEqual([keep]);
    const undo = page.getByTestId("undo-toast");
    await expect(undo).toContainText(`${remove} removed`);

    await undo.getByRole("button", { name: "Undo" }).click();
    await expectRosterContains(page, request, eventId, remove);
    expect((await getRoster(request, eventId)).sort()).toEqual([keep, remove].sort());
  });

  test("a signed-in player is asked before taking a guest off the list", async ({ page, request }) => {
    // Someone else owns the game: the viewer is a player, not the organizer.
    await signInOn(request, "Game Owner");
    const gameId = await createEvent(request, "E2E Remove Guest Confirm Game");
    const guest = "GuestGamma";
    await addPlayerViaApi(request, gameId, guest);
    await signIn(page, "Guest Remover");

    await page.goto(`/events/${gameId}`);
    await openWhosIn(page);
    await expectRosterContains(page, request, gameId, guest);
    await page.getByRole("button", { name: `Options for ${guest}` }).first().click();
    await page.getByRole("button", { name: `Remove ${guest}` }).click();

    // They are asked first; cancelling keeps the guest.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("They will lose their place.");
    await page.getByTestId("leave-dialog-cancel").click();
    await expect(dialog).toBeHidden();
    expect(await getRoster(request, gameId)).toEqual([guest]);

    // Asking again and confirming takes exactly that guest off.
    await page.getByRole("button", { name: `Options for ${guest}` }).first().click();
    await page.getByRole("button", { name: `Remove ${guest}` }).click();
    await page.getByTestId("leave-dialog-confirm").click();
    await expectRosterOmits(page, request, gameId, guest);
  });
});
