import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { logger } from "~/lib/logger.server";

/** Safe credential shape — never leaks password or OAuth tokens. */
interface CredentialView {
  id: string;
  providerId: string;
  accountId: string;
  issuer: string | null;
  createdAt: string;
}

function toCredentialView(row: {
  id: string;
  providerId: string;
  accountId: string;
  issuer: string | null;
  createdAt: Date;
}): CredentialView {
  return {
    id: row.id,
    providerId: row.providerId,
    accountId: row.accountId,
    issuer: row.issuer,
    createdAt: row.createdAt.toISOString(),
  };
}

/** GET /api/me/credentials — list credentials attached to the session user */
export const GET: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.account.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  return Response.json({ credentials: accounts.map(toCredentialView) });
};

/** DELETE /api/me/credentials — unlink a credential; block when it is the sole one (ADR 0040) */
export const DELETE: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const accountId = typeof body.accountId === "string" ? body.accountId : "";
  if (!accountId) {
    return Response.json({ error: "accountId is required." }, { status: 400 });
  }

  const userId = session.user.id;
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) {
    return Response.json({ error: "Credential not found." }, { status: 404 });
  }

  const count = await prisma.account.count({ where: { userId } });
  if (count <= 1) {
    return Response.json(
      { error: "Cannot remove your only sign-in method — keep at least one credential." },
      { status: 403 },
    );
  }

  await prisma.account.delete({ where: { id: account.id } });
  logger.info({ userId, providerId: account.providerId }, "Credential unlinked");
  return Response.json({ ok: true });
};
