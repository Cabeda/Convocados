import type { APIRoute } from "astro";
import { auth } from "~/lib/auth.server";

/**
 * RFC 7591 DCR endpoint with CIMD preference (MCP 2026-07-28).
 * DCR is deprecated in favor of Client ID Metadata Documents (CIMD).
 * This wrapper adds deprecation headers and supports `client_metadata_uri`
 * per SEP-2352: client credentials bound to issuer, no reuse across AS.
 */
const handler: APIRoute = async ({ request }) => {
  // CIMD: if client sends client_metadata_uri, fetch and inline as client_metadata
  // per https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/
  if (request.method === "POST") {
    const clone = request.clone();
    try {
      const body: any = await clone.json();
      if (body?.client_metadata_uri && !body?.client_metadata) {
        try {
          const resp = await fetch(body.client_metadata_uri, { headers: { accept: "application/json" } });
          if (resp.ok) {
            const cimd = await resp.json();
            // Merge CIMD into registration — server treats it as client_metadata
            body.client_metadata = cimd;
            delete body.client_metadata_uri;
            // Rebuild request with inlined metadata for auth.handler
            request = new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: JSON.stringify(body),
            });
          }
        } catch {
          // CIMD fetch failed — let auth.handler return 400
        }
      }
    } catch {
      // not JSON — let handler deal
    }
  }

  const res = await auth.handler(request);
  // RFC 9207 + DCR deprecation: signal that DCR will be removed, prefer CIMD
  const headers = new Headers(res.headers);
  if (request.method === "POST") {
    headers.set("Deprecation", "true");
    headers.set("Sunset", "Thu, 28 Jul 2027 00:00:00 GMT"); // 12-month off-ramp per spec
    headers.set("Link", '<https://modelcontextprotocol.io/specification/2026-07-28>; rel="deprecation"');
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

export const POST = handler;
export const GET = handler;
