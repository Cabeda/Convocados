# 0022 — Stateless MCP endpoint (2026-07-28)

**Status:** Accepted
**Date:** 2026-08-22

## Context

Convocados already acts as an OAuth 2.1 provider (PKCE, `/.well-known/openid-configuration`, Bearer bypass in `src/middleware.ts:148`) and is advertised as "MCP-ready". AI assistants need programmatic access to Games/Players/Balances without sticky sessions on Fly. MCP `2026-07-28` makes stateless the core: no `initialize`/`Mcp-Session-Id`, header-routed (`Mcp-Method`/`Mcp-Name`), cacheable `tools/list`, RFC 9207 `iss` + CIMD.

## Decision

Expose a single stateless Streamable HTTP server at `POST /api/mcp` (plus `GET` hint for SSE compat) implementing MCP `2026-07-28` strictly. No session, no `initialize` (400 + hint to `server/discover`), `MCP-Protocol-Version: 2026-07-28` required, `Mcp-Method`/`Mcp-Name` mandatory. Auth via existing OAuth Bearer (`read:events`, `manage:players`, etc.) with new `/.well-known/oauth-protected-resource` + `oauth-authorization-server` and `iss` validation; keep DCR deprecated, prefer CIMD. V1 tools read-only, Game-centric, prefixed `convocados_` (`list_my_games`, `get_game`, `list_players`, `get_balance`, `get_history`, `get_ratings`) with deterministic order and `ttlMs 60s cacheScope global`. No MRTR/Tasks in V1 — hard-gate errors fail fast.

## Considered Options

- **Stateful SSE (2024-11) with `Mcp-Session-Id`** — rejected: requires sticky/shared storage, opposes Fly round-robin, complexity for no benefit (no subscriptions needed V1).
- **Dual-version compat (2025-03 + 2026-07)** — rejected: doubles code/branching, legacy SSE deprecated with 12-month off-ramp. Strict cut simplifies.
- **MRTR + Tasks from day one** — rejected: only `add_player` confirmation would use it; defer until real elicitation need.
- **Anonymous public reads via MCP** — rejected: leaks `Event`/`Game` semantics, scope gating required for privacy.

## Consequences

- Any instance handles any request; horizontal scale trivial.
- Gateway/WAF can route/meter on `Mcp-Name` without body parse.
- Older MCP clients sending `initialize` get explicit error, must upgrade.
- Glossary tightens `Event` vs `Game` in tool naming (`CONTEXT.md`); payment lifecycle stays projection, not auto-promoted via MCP.
