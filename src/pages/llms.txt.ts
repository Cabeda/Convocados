import type { APIRoute } from "astro";
import { buildLlmsTxt } from "../lib/llmsTxt";

/**
 * `/llms.txt` — machine-readable index for browsing LLM agents.
 * Generated from the OpenAPI spec and the docs nav; never hand-edited.
 */
export const GET: APIRoute = async ({ request }) => {
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";

  return new Response(buildLlmsTxt(`${proto}://${host}`), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
