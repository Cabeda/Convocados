#!/usr/bin/env node
/**
 * Record the demo video OpenAI's ChatGPT app submission asks for: the reviewer
 * account signing in, the demo games, and live MCP tool calls against
 * production with their real JSON results.
 *
 * Nothing here is mocked. The tool calls go over HTTPS to the deployed MCP
 * endpoint with an API key minted for the demo account, and the roster change
 * they make is reloaded in the browser so the video shows the write landing.
 *
 *   REVIEWER_EMAIL=... REVIEWER_PASSWORD=... node scripts/demo-video.mjs
 *
 * Output: tmp/demo-video/convocados-mcp-demo.mp4
 */
import { chromium } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "https://convocados.cabeda.dev";
const EMAIL = process.env.REVIEWER_EMAIL;
const PASSWORD = process.env.REVIEWER_PASSWORD;
const OUT_DIR = path.resolve("tmp/demo-video");
const MP4 = path.join(OUT_DIR, "convocados-mcp-demo.mp4");
const W = 1280;
const H = 720;

if (!EMAIL || !PASSWORD) {
  console.error("REVIEWER_EMAIL and REVIEWER_PASSWORD are required.");
  process.exit(2);
}

/** The account's games, as the sign-in response reports them. */
let mondayId, sundayId;

async function signInOverHttp() {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed (${res.status})`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function mintApiKey(cookie) {
  // A key is cheaper to drive than the full OAuth consent round-trip, and the
  // MCP endpoint accepts both (src/lib/authenticate.server.ts).
  const res = await fetch(`${BASE}/api/me/api-keys`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "demo-video",
      scopes: [
        "read:profile", "read:events", "write:events", "create:events",
        "manage:players", "read:ratings", "read:history", "manage:teams", "manage:payments",
      ],
    }),
  });
  if (!res.ok) throw new Error(`api key creation failed (${res.status}): ${await res.text()}`);
  const body = await res.json();
  return body.key ?? body.apiKey ?? body.token;
}

let rpcId = 0;
async function mcp(key, method, name, args) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(name ? { "Mcp-Name": name } : {}),
    },
    body: JSON.stringify(
      name
        ? { jsonrpc: "2.0", id: ++rpcId, method, params: { name, arguments: args ?? {} } }
        : { jsonrpc: "2.0", id: ++rpcId, method },
    ),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${name ?? method}: ${json.error.message}`);
  return json.result;
}

/** tools/call returns `content: [{type:"text", text:"<json>"}]` — unwrap it. */
function unwrap(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return text; }
}

/** A slide the browser can render, so the video shows it instead of a terminal. */
function slide({ title, subtitle = "", rows = [], mono = false }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0d1117;color:#e6edf3;
      font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
    .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:56px 64px;box-sizing:border-box}
    h1{font-size:40px;margin:0 0 10px;letter-spacing:-.02em}
    h2{font-size:22px;margin:0 0 28px;color:#8b949e;font-weight:500}
    .rows{display:flex;flex-direction:column;gap:16px}
    .row{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:16px 18px}
    .k{font-size:14px;color:#7ee787;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px}
    pre{margin:0;white-space:pre-wrap;font-size:14px;line-height:1.45;color:#c9d1d9;
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    ${mono ? "pre{font-size:13px}" : ""}
  </style></head><body><div class="wrap">
    <h1>${title}</h1>${subtitle ? `<h2>${subtitle}</h2>` : ""}
    <div class="rows">${rows
      .map((r) => `<div class="row"><div class="k">${r.k}</div><pre>${r.body}</pre></div>`)
      .join("")}</div></div></body></html>`;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const pretty = (v) => esc(JSON.stringify(v, null, 2)).slice(0, 900);

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const cookie = await signInOverHttp();
  const key = await mintApiKey(cookie);
  if (!key) throw new Error("no API key in the response");

  const toolList = await mcp(key, "tools/list");
  const games = unwrap(await mcp(key, "tools/call", "convocados_list_my_games"));
  const owned = games.owned ?? [];
  mondayId = owned.find((g) => /Monday 5-a-side/.test(g.title))?.id ?? owned[0]?.id;
  sundayId = owned.find((g) => /Sunday Football/.test(g.title))?.id;
  if (!mondayId) throw new Error(`no demo games on this account: ${pretty(games)}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT_DIR, size: { width: W, height: H } },
  });
  const page = await context.newPage();
  const wait = (ms) => page.waitForTimeout(ms);

  // ── 1. Title
  await page.setContent(slide({
    title: "Convocados — MCP server",
    subtitle: `${toolList.tools.length} tools · OAuth 2.1 + PKCE · confirmation before every write`,
    rows: [
      { k: "Endpoint", body: `${BASE}/api/mcp` },
      { k: "Demo account", body: EMAIL },
      { k: "What this recording shows", body: "sign-in → demo games → live tool calls with their real JSON results" },
    ],
  }));
  await wait(4200);

  // ── 2. Sign in as the reviewer
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /password/i }).click().catch(() => {});
  await page.getByLabel(/email/i).first().fill(EMAIL);
  await page.getByLabel(/password/i).first().fill(PASSWORD);
  await wait(900);
  await page.getByRole("button", { name: /sign in/i }).last().click();
  await page.waitForURL(/dashboard|\/$/, { timeout: 30_000 }).catch(() => {});
  await wait(2500);

  // ── 3. The account's games
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await wait(3000);

  // ── 4. The 16 tools, straight from tools/list
  await page.setContent(slide({
    title: `tools/list → ${toolList.tools.length} tools`,
    subtitle: "Every tool carries a title, a readOnly/destructive hint and its OAuth scopes",
    rows: [{
      k: "Tool names",
      body: esc(toolList.tools.map((t) => `${t.name}${t.annotations?.readOnlyHint ? "" : "  (write)"}`).join("\n")),
    }],
    mono: true,
  }));
  await wait(5200);

  // ── 5. A write, through MCP, then the same roster in the browser
  const added = unwrap(await mcp(key, "tools/call", "convocados_add_player", {
    eventId: mondayId,
    name: "Video Demo Player",
  }));
  await page.setContent(slide({
    title: "convocados_add_player → the write lands",
    subtitle: "ChatGPT asks the user to confirm before this call is made",
    rows: [
      { k: "Request", body: esc(`{ "eventId": "${mondayId}", "name": "Video Demo Player" }`) },
      { k: "Result", body: pretty(added) },
    ],
  }));
  await wait(4200);

  await page.goto(`${BASE}/events/${mondayId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Video Demo Player", { timeout: 20_000 }).catch(() => {});
  // Bring the roster into frame: the top of the page also carries a
  // post-game checklist card that has nothing to do with what this shows.
  await page.locator("text=/Playing \\(/").first().scrollIntoViewIfNeeded().catch(() => {});
  await wait(3800);

  // ── 6. Balance and history from the same account
  const balance = unwrap(await mcp(key, "tools/call", "convocados_get_balance", { eventId: mondayId }));
  const history = sundayId
    ? unwrap(await mcp(key, "tools/call", "convocados_get_history", { eventId: sundayId }))
    : null;
  await page.setContent(slide({
    title: "Reads: balance and history",
    subtitle: "Same account, same session — the numbers are the ones on those pages",
    rows: [
      {
        // The per-player list is elided here only to keep the frame legible;
        // the counts and the aggregate are exactly what the tool returned.
        k: "convocados_get_balance (per-player balances elided)",
        body: pretty({
          eventId: balance.eventId,
          paidCount: balance.paidCount,
          totalCount: balance.totalCount,
          aggregate: balance.aggregate,
          balanceRows: balance.balances?.length ?? 0,
        }),
      },
      ...(history ? [{ k: "convocados_get_history", body: pretty(history).slice(0, 620) }] : []),
    ],
    mono: true,
  }));
  await wait(5200);

  // ── 7. Clean up the player the recording added
  const removed = unwrap(await mcp(key, "tools/call", "convocados_remove_player", {
    eventId: mondayId,
    name: "Video Demo Player",
  }));
  await page.setContent(slide({
    title: "convocados_remove_player → the roster is back",
    subtitle: "The demo account is left exactly as the reviewer finds it",
    rows: [{ k: "Result", body: pretty(removed) }],
  }));
  await wait(3200);

  // ── 8. The docs the reviewer reads
  await page.goto(`${BASE}/docs/mcp`, { waitUntil: "domcontentloaded" });
  await wait(4500);

  // ── 9. End card
  await page.setContent(slide({
    title: "Convocados — ready for review",
    subtitle: `${BASE}/api/mcp · ${toolList.tools.length} tools · OAuth 2.1`,
    rows: [
      { k: "Reviewer sign-in", body: `${BASE}/auth/signin\n${EMAIL}` },
      { k: "Privacy policy", body: `${BASE}/privacy` },
      { k: "Terms of service", body: `${BASE}/terms` },
    ],
  }));
  await wait(4500);

  await context.close();
  await browser.close();

  const recorded = await page.video()?.path();
  if (!recorded) throw new Error("Playwright recorded no video");
  renameSync(recorded, MP4);
  console.log(`video: ${MP4}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
