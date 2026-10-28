import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { rateLimitResponseForKey } from "../../../lib/apiRateLimit.server";
import {
  parsePaymentMethods,
  validatePaymentMethods,
  normalizePaymentMethod,
  type PaymentMethod,
} from "../../../lib/paymentMethods";

/**
 * The caller's own Payment Details (ADR 0055).
 *
 * These are what a Payer offers the group when they are owed money. They belong
 * to the person, never to an Event, and `sharePaymentDetails` is a separate
 * consent flag: saving details is not agreeing to publish them.
 */

/** Digits, with an optional leading +. */
function normalizePhone(raw: string): string {
  const compact = raw.replace(/[\s()-]/g, "");
  return compact.startsWith("+") ? "+" + compact.slice(1).replace(/\D/g, "") : compact.replace(/\D/g, "");
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
}

function serialize(user: {
  phone: string | null;
  paymentDetails: string | null;
  sharePaymentDetails: boolean;
}) {
  return {
    phone: user.phone,
    paymentDetails: parsePaymentMethods(user.paymentDetails),
    sharePaymentDetails: user.sharePaymentDetails,
  };
}

async function resolveUserId(request: Request): Promise<string | null> {
  const authCtx = await authenticateRequest(request);
  return authCtx?.userId ?? (await getSession(request))?.user?.id ?? null;
}

export const GET: APIRoute = async ({ request }) => {
  const userId = await resolveUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, paymentDetails: true, sharePaymentDetails: true },
  });
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  return Response.json(serialize(user));
};

export const PUT: APIRoute = async ({ request }) => {
  const userId = await resolveUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await rateLimitResponseForKey(userId, "write");
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const data: { phone?: string | null; paymentDetails?: string | null; sharePaymentDetails?: boolean } = {};

  if (body.phone !== undefined) {
    if (body.phone === null || (typeof body.phone === "string" && !body.phone.trim())) {
      data.phone = null;
    } else if (typeof body.phone !== "string") {
      return Response.json({ error: "Invalid phone number." }, { status: 400 });
    } else {
      const phone = normalizePhone(body.phone);
      if (!isValidPhone(phone)) {
        return Response.json({ error: "Phone number must have 6-15 digits." }, { status: 400 });
      }
      data.phone = phone;
    }
  }

  if (body.paymentDetails !== undefined) {
    const error = validatePaymentMethods(body.paymentDetails);
    if (error) {
      return Response.json({ error }, { status: 400 });
    }
    const methods = (body.paymentDetails as PaymentMethod[]).map(normalizePaymentMethod);
    data.paymentDetails = methods.length > 0 ? JSON.stringify(methods) : null;
  }

  if (body.sharePaymentDetails !== undefined) {
    if (typeof body.sharePaymentDetails !== "boolean") {
      return Response.json({ error: "sharePaymentDetails must be a boolean." }, { status: 400 });
    }
    data.sharePaymentDetails = body.sharePaymentDetails;
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: { phone: true, paymentDetails: true, sharePaymentDetails: true },
  });

  return Response.json(serialize(updated));
};
