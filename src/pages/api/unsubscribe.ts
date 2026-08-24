import type { APIRoute } from "astro";
import {
  applyUnsubscribe,
  isUnsubscribeType,
  validateUnsubscribeToken,
} from "~/lib/unsubscribe.server";
import { createLogger } from "~/lib/logger.server";

const log = createLogger("unsubscribe");

function htmlPage(title: string, body: string, status = 200): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${title} — Convocados</title></head>
<body style="margin:0;padding:0;background-color:#f8faf6;font-family:'Inter','Roboto','Helvetica',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8faf6;">
    <tr><td align="center" style="padding:60px 16px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="padding:40px 32px;text-align:center;">
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1a1d1b;">${title}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a6358;">${body}</p>
          <a href="/settings/notifications" style="display:inline-block;padding:12px 28px;border-radius:24px;background-color:#1b6b4a;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Email preferences</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const type = url.searchParams.get("type");

  if (!token) {
    return htmlPage("Invalid link", "This unsubscribe link is missing its token. Please use the link from your email.", 400);
  }
  if (!isUnsubscribeType(type)) {
    return htmlPage("Unknown email type", "We couldn't tell which emails this link refers to. Please use the link from your email.", 400);
  }

  const match = await validateUnsubscribeToken(token);
  if (!match) {
    return htmlPage("Link not recognised", "This unsubscribe link is no longer valid — it may have been revoked. Sign in to manage your email preferences instead.", 404);
  }

  await applyUnsubscribe(match.userId, type);
  log.info({ userId: match.userId, type }, "Email unsubscribed");

  return htmlPage(
    "You're unsubscribed",
    type === "all"
      ? "You won't receive any more notification emails from Convocados. Account security emails (like sign-in links) will still be sent."
      : "You won't receive this type of email anymore. You can re-enable it anytime in your preferences.",
  );
}

/** GET — user clicks the unsubscribe link in an email footer (no login needed). */
export const GET: APIRoute = async ({ request }) => handle(request);

/** POST — RFC 8058 one-click unsubscribe triggered by the mail client. */
export const POST: APIRoute = async ({ request }) => handle(request);
