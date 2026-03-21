import type { APIRoute } from "astro";
import { getAvailability } from "../../../lib/playtomic.server";
import { rateLimitResponse } from "../../../lib/apiRateLimit.server";

export const GET: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const date = url.searchParams.get("date") ?? "";
  const sport = url.searchParams.get("sport") ?? "";
  const duration = parseInt(url.searchParams.get("duration") ?? "90", 10);

  if (!tenantId) {
    return Response.json({ error: "tenantId is required." }, { status: 400 });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date is required (YYYY-MM-DD)." }, { status: 400 });
  }
  if (!sport) {
    return Response.json({ error: "sport is required." }, { status: 400 });
  }

  const result = await getAvailability({ tenantId, date, sport, duration });

  if (result.error) {
    return Response.json({ courts: [], error: result.error }, { status: 502 });
  }

  return Response.json({ courts: result.courts });
};
