import type { APIRoute } from "astro";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { searchPlaces, reversePlaceName } from "~/lib/places.server";

/**
 * Place lookup for the location pickers (Android and, later, web).
 *
 * GET /api/places?q=<text>          → ranked autocomplete suggestions
 * GET /api/places?lat=<>&lng=<>     → reverse-geocoded name for a dropped pin
 *
 * Proxied server-side so clients never call Photon/Nominatim directly — that
 * keeps the free services within their usage policy and lets us rank sports
 * venues first. Auth is required: this must not become an open proxy.
 */
export const GET: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");
  const hasCoords = lat !== null && lng !== null;

  if (hasCoords) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return Response.json({ error: "lat and lng must be numbers." }, { status: 400 });
    }

    // With a query, coordinates are a *bias* (nearby results first). Without
    // one, they're the subject: reverse-geocode the pin to a name.
    if (query) {
      const suggestions = await searchPlaces(query, { bias: { latitude, longitude } });
      return Response.json({ suggestions });
    }

    const name = await reversePlaceName(latitude, longitude);
    return Response.json({ name });
  }

  if (!query) {
    return Response.json({ suggestions: [] });
  }

  const suggestions = await searchPlaces(query);
  return Response.json({ suggestions });
};
