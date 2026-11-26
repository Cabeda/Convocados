import type { APIRoute } from "astro";
import { auth } from "~/lib/auth.server";
import { oauthRateLimitResponse } from "~/lib/oauthRateLimit.server";

/**
 * RFC 7591 DCR endpoint.
 * DCR is deprecated in favor of Client ID Metadata Documents (CIMD), but
 * `client_metadata_uri` is refused rather than fetched: better-auth's
 * registration schema strips the fetched document, so dialing a caller's URL
 * would only turn this endpoint into an SSRF primitive.
 */
const handler: APIRoute = async ({ request }) => {
  // This concrete route shadows the [...all] catch-all, so it must apply the
  // OAuth limits itself or the 5/hour DCR limit never runs.
  const limited = await oauthRateLimitResponse(request);
  if (limited) return limited;

  if (request.method === "POST") {
    try {
      const body: any = await request.clone().json();
      if (body?.client_metadata_uri) {
        return Response.json(
          {
            error: "invalid_client_metadata",
            error_description: "client_metadata_uri is not supported",
          },
          { status: 400 },
        );
      }
    } catch {
      // not JSON — let the auth handler deal with it
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
