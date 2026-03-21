import type { APIRoute } from "astro";
import { searchClubs } from "../../../lib/playtomic.server";
import { rateLimitResponse } from "../../../lib/apiRateLimit.server";

export const GET: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") ?? "");
  const lng = parseFloat(url.searchParams.get("lng") ?? "");
  const sport = url.searchParams.get("sport") ?? "";
  const radius = parseInt(url.searchParams.get("radius") ?? "15000", 10);
  const size = parseInt(url.searchParams.get("size") ?? "20", 10);

  if (isNaN(lat) || isNaN(lng)) {
    return Response.json({ error: "lat and lng are required." }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return Response.json({ error: "Invalid coordinates." }, { status: 400 });
  }
  if (!sport) {
    return Response.json({ error: "sport is required." }, { status: 400 });
  }

  const result = await searchClubs({ lat, lng, sport, radius, size });

  if (result.error) {
    return Response.json({ clubs: [], error: result.error }, { status: 502 });
  }

  return Response.json({ clubs: result.clubs });
};
