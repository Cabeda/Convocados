import type { APIRoute } from "astro";

/**
 * Local OAuth callback endpoint for Bruno CLI testing.
 *
 * When the authorize endpoint redirects here with ?code=...&state=...,
 * this endpoint simply returns the parameters as JSON so Bruno CLI
 * can capture them in a post-response script.
 *
 * This is NOT used in production — only for API testing with Bruno CLI.
 */
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return Response.json({ error, error_description: url.searchParams.get("error_description") }, { status: 400 });
  }

  if (!code) {
    return Response.json({ error: "missing_code", error_description: "No authorization code in callback" }, { status: 400 });
  }

  return Response.json({ code, state });
};
