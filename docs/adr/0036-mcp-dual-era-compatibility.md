# ADR 0036 — Serve both MCP eras; initialize is not retired

Status: accepted (2026-09-18)

## Context

ADR 0022 built `/api/mcp` strictly for the stateless `2026-07-28` lifecycle:
no `initialize`, `Mcp-Method`/`Mcp-Name` headers mandatory, `MCP-Protocol-Version`
must equal `2026-07-28`. That is correct for the modern era but incompatible
with handshake-era clients.

ChatGPT developer mode is a handshake-era client: it opens with `initialize`,
sends `notifications/initialized`, and does not send `Mcp-Method`. Against our
endpoint it failed at the first request, so the MCP integration could not be
connected at all. The same is true of every pre-2026 MCP client.

## Decision

Serve **both** eras from the one endpoint, the way the official SDKs do:

- **Handshake era (≤ 2025-11-25):** `initialize` negotiates a version (echo the
  client's if we support it, otherwise counter-offer `2025-11-25`);
  `notifications/*` returns `202` with no body; `ping` returns `{}`.
  `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers are optional and only
  validated when present.
- **Modern era (2026-07-28):** unchanged — `server/discover`, stateless,
  `_meta` protocol version.

Mixed authentication per the OpenAI app spec:

- `initialize`, `tools/list`, and tools marked `requiresAuth: false` work
  anonymously. Anonymous read tools: `convocados_list_public_events` and
  `convocados_get_game` (link-accessible; password-locked returns
  `{ locked: true }`).
- Every other `tools/call` requires OAuth 2.1. A missing/invalid token returns
  `401` with `WWW-Authenticate: Bearer resource_metadata="…", scope="…"` so the
  client can discover the authorization server.

## Consequences

- ChatGPT (and other handshake clients) can connect with no per-client config;
  DCR already lets them register themselves.
- The strict `2026-07-28`-only tests are replaced by dual-era coverage; the
  modern path is preserved.
- `initialize` is no longer an error. ADR 0022's "retired" stance is superseded
  for interoperability; the stateless design is retained as one of two eras.
- New tools default to requiring auth; anonymity is an explicit opt-out.
