import type { APIRoute } from "astro";
import { openApiSpec } from "../../lib/openapi";

export const GET: APIRoute = async () => {
  return Response.json(openApiSpec, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
};
