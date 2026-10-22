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

export const SERVER_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: false },
};

export const SERVER_INSTRUCTIONS =
  "Convocados organizes pickup sports games. Read tools work anonymously for " +
  "public/link-accessible events; everything else requires OAuth 2.1. " +
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
  return `Bearer error="insufficient_scope", scope="${scopes.join(" ")}"`;
}
