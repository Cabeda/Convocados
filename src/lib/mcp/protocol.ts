import pkg from "../../../package.json";

/**
 * MCP protocol eras.
 *
 * - Handshake era (≤ 2025-11-25): `initialize` / `notifications/initialized`,
 *   version negotiated once, optional `Mcp-Session-Id`.
 * - Modern era (2026-07-28): stateless, no handshake; clients call
 *   `server/discover` and carry their version in `_meta` on every request.
 *
 * We serve both from the same endpoint. ChatGPT (developer mode) speaks the
 * handshake era, so `initialize` must never be rejected.
 */

export const MODERN_VERSION = "2026-07-28";

/** Handshake-era revisions, newest first. */
export const HANDSHAKE_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const LATEST_HANDSHAKE_VERSION = "2025-11-25";

export const SUPPORTED_VERSIONS: readonly string[] = [
  MODERN_VERSION,
  ...HANDSHAKE_VERSIONS,
];

export const SERVER_INFO = { name: "convocados", version: pkg.version };

/**
 * Only what we actually serve. Advertising `resources` here while
 * `resources/list` answers -32601 makes a strict client treat the server as
 * degraded — ChatGPT dropped every tool from the connector on the day we did.
 */
export const SERVER_CAPABILITIES = {
  tools: { listChanged: false },
};

export const SERVER_INSTRUCTIONS =
  "Convocados organizes pickup sports games. When the user asks to create, " +
  "edit, cancel, fill, staff or score a game, call the matching convocados_* " +
  "tool — do not tell them to do it in the app by hand. Pass dateTime as local " +
  "wall-clock ISO 8601 (2026-10-29T20:00) together with the user's IANA " +
  "timezone (Europe/Lisbon): without a timezone the time is stored as UTC and " +
  "the game lands at the wrong hour. Ask for a missing title, date/time or " +
  "location before calling. Most write tools only accept games the user owns " +
  "or administers; RSVP, leaving a game and claiming a player are self-service. " +
  "Read tools also work anonymously for public or link-accessible games. " +
  "Supports both the 2026-07-28 stateless lifecycle (server/discover) and the " +
  "initialize handshake.";

/** Is this a protocol revision we can speak? */
export function isSupportedVersion(version: string | null | undefined): boolean {
  return !!version && SUPPORTED_VERSIONS.includes(version);
}

/**
 * Answer an `initialize` handshake. If the client asked for a handshake-era
 * revision we support, echo it; otherwise counter-offer our latest handshake
 * revision (which is what SDKs do when a modern version is requested through
 * `initialize`).
 */
export function negotiateHandshakeVersion(clientVersion?: string | null): string {
  if (clientVersion && (HANDSHAKE_VERSIONS as readonly string[]).includes(clientVersion)) {
    return clientVersion;
  }
  return LATEST_HANDSHAKE_VERSION;
}

/** RFC 9728 protected-resource metadata URL for this deployment. */
export function protectedResourceMetadataUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
}

/** `WWW-Authenticate` challenge so clients can discover the OAuth metadata. */
export function wwwAuthenticate(baseUrl: string, scope: string): string {
  return `Bearer resource_metadata="${protectedResourceMetadataUrl(baseUrl)}", scope="${scope}"`;
}

/**
 * RFC 6750 step-up challenge for a token that lacks a scope.
 *
 * The `scope` parameter must name every scope the caller still needs, not only
 * the missing one: Claude does not carry scopes from an earlier step-up into
 * the next authorization request. A 403 without this header is a terminal
 * error in Claude, so the connector never offers to re-authorize.
 */
export function insufficientScopeChallenge(scopes: string[]): string {
  return `Bearer error="insufficient_scope", error_description="Additional scope required", scope="${scopes.join(" ")}"`;
}
