import type { APIRoute } from "astro";
import { auth } from "../../../lib/auth.server";

const handler: APIRoute = async ({ request }) => {
  return auth.handler(request);
};

export const GET = handler;
export const POST = handler;
