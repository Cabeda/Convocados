import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { generateApiKey, API_SCOPES } from "../../../lib/apiKey.server";

const MAX_KEYS_PER_USER = 10;

/** GET — list API keys for the authenticated user */
export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return Response.json({
    keys: keys.map((k) => ({
      ...k,
      scopes: JSON.parse(k.scopes),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    })),
  });
};

/** POST — create a new API key */
export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  const requestedScopes: string[] = Array.isArray(body.scopes) ? body.scopes : [];
  const validScopes = requestedScopes.filter((s) =>
    (API_SCOPES as readonly string[]).includes(s),
  );

  const count = await prisma.apiKey.count({ where: { userId: session.user.id } });
  if (count >= MAX_KEYS_PER_USER) {
    return Response.json({ error: `Maximum ${MAX_KEYS_PER_USER} API keys per user.` }, { status: 429 });
  }

  const { raw, hashed } = generateApiKey();

  const key = await prisma.apiKey.create({
    data: {
      name: name.slice(0, 100),
      prefix: raw.slice(0, 8),
      hashedKey: hashed,
      userId: session.user.id,
      scopes: JSON.stringify(validScopes),
    },
  });

  // Return the raw key only once — it cannot be retrieved again
  return Response.json({
    id: key.id,
    name: key.name,
    key: raw,
    prefix: key.prefix,
    scopes: validScopes,
    createdAt: key.createdAt.toISOString(),
  }, { status: 201 });
};

/** DELETE — revoke an API key by id (passed in body) */
export const DELETE: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const keyId = String(body.id ?? "").trim();
  if (!keyId) {
    return Response.json({ error: "Key id is required." }, { status: 400 });
  }

  const key = await prisma.apiKey.findFirst({
    where: { id: keyId, userId: session.user.id },
  });
  if (!key) {
    return Response.json({ error: "Key not found." }, { status: 404 });
  }

  await prisma.apiKey.delete({ where: { id: keyId } });
  return Response.json({ ok: true });
};
