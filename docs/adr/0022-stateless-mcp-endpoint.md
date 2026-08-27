# 0022 — Stateless MCP endpoint (2026-07-28)

**Status:** Accepted
**Date:** 2026-08-22

## Context

Convocados already acts as an OAuth 2.1 provider (PKCE, `/.well-known/openid-configuration`, Bearer bypass in `src/middleware.ts:148`) and is advertised as "MCP-ready". AI assistants need programmatic access to Games/Players/Balances without sticky sessions on Fly. MCP `2026-07-28` makes stateless the core: no `initialize`/`Mcp-Session-Id`, header-routed (`Mcp-Method`/`Mcp-Name`), cacheable `tools/list`, RFC 9207 `iss` + CIMD.

## Decision

Expose a single stateless Streamable HTTP server at `POST /api/mcp` (plus `GET` hint for SSE compat) implementing MCP `2026-07-28` strictly. No session, no `initialize` (400 + hint to `server/discover`), `MCP-Protocol-Version: 2026-07-28` required, `Mcp-Method`/`Mcp-Name` mandatory. Auth via existing OAuth Bearer (`read:events`, `manage:players`, etc.) with new `/.well-known/oauth-protected-resource` + `oauth-authorization-server` and `iss` validation; keep DCR deprecated, prefer CIMD.

### V1 — read-only tools

V1 tools are read-only, Game-centric, prefixed `convocados_` (`list_my_games`, `get_game`, `list_players`, `get_balance`, `get_history`, `get_ratings`) with deterministic order and `ttlMs 60s cacheScope global`. No MRTR/Tasks in V1 — hard-gate errors fail fast.

### V1.5 — write tools

V1.5 adds the core mutation set the organizer's assistant needs, reusing the same server-side libs as the REST routes (rosterCore, `archiveAndLeave`, `settlement.server`, `elo.server`, `payments.server`) so MCP and web behavior stay identical:

| Tool | Scope | Reuses |
|---|---|---|
| `convocados_add_player` | `manage:players` | `resolveRosterTarget`/`upsert*ForRoster`, `syncGamePayments`, `addPlayerToTeams` |
| `convocados_remove_player` | `manage:players` | `archiveAndLeave` |
| `convocados_randomize_teams` | `manage:teams` | `Randomize`/`balanceTeams` |
| `convocados_update_payment` | `manage:payments` | `recordReceived` (ledger credit on `paid`) |
| `convocados_set_score` | `write:events` | `gameHistory.update` + best-effort `processGame` (ELO) |
| `convocados_create_event` | `create:events` | event + first `Game` creation (no geocoding) |

**Authorization:** scope gating alone is not enough for mutations. Every event-scoped write tool additionally verifies the caller is the event **owner or an admin** (`requireEventAccess`) — an OAuth token cannot mutate an event the user does not run. `create_event` (no parent event) is gated on scope only.

**Mutations are rate-limited** via the existing `write` preset on `tools/call` (already applied).

## Considered Options

- **Stateful SSE (2024-11) with `Mcp-Session-Id`** — rejected: requires sticky/shared storage, opposes Fly round-robin, complexity for no benefit (no subscriptions needed V1).
- **Dual-version compat (2025-03 + 2026-07)** — rejected: doubles code/branching, legacy SSE deprecated with 12-month off-ramp. Strict cut simplifies.
- **MRTR + Tasks from day one** — rejected: only `add_player` confirmation would use it; defer until real elicitation need.
- **Anonymous public reads via MCP** — rejected: leaks `Event`/`Game` semantics, scope gating required for privacy.
- **WebMCP integration** (Chrome origin-trial API: `document.modelContext.registerTool` + declarative form annotations) — **deferred, documented only.** WebMCP is a *client-side* API: tools are registered per-page in the browser (origin-isolated document, `tools` permissions policy, Chrome 149+ origin trial) and actuate the UI as the signed-in user. It is complementary to, not a replacement for, the server MCP: our MCP is for external agents (OAuth, stateless), WebMCP would be for in-browser agents acting on the event page. Rejected for V1.5 because (a) it is an origin trial with a registration + `chrome://flags` requirement, (b) our key screens are a React SPA — the imperative API would duplicate existing client logic and the declarative API needs plain HTML forms we do not have, (c) no human-in-the-loop confirmation surface exists for agent-initiated mutations. Revisit when the origin trial stabilizes (Chrome stable) and the `usewebmcp`/`webmcp-types` ecosystem settles; the MCP write tools above are the exact shape a future `registerTool` wrapper would call.

## Consequences

- Any instance handles any request; horizontal scale trivial.
- Gateway/WAF can route/meter on `Mcp-Name` without body parse.
- Older MCP clients sending `initialize` get explicit error, must upgrade.
- Glossary tightens `Event` vs `Game` in tool naming (`CONTEXT.md`); payment lifecycle stays projection, not auto-promoted via MCP.
- Write tools are gated on ownership/admin on top of OAuth scope — an assistant never mutates events it does not run.
- WebMCP is tracked as a follow-up (origin-trial stability gate), not implemented.
