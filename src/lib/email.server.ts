import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = import.meta.env.RESEND_API_KEY ?? process.env.RESEND_API_KEY;
    _resend = new Resend(key);
  }
  return _resend;
}

/** Visible for testing — resets the cached Resend client */
export function _resetResendClient() {
  _resend = null;
}

const EMAIL_FROM = import.meta.env.EMAIL_FROM ?? process.env.EMAIL_FROM ?? "Convocados <noreply@cabeda.dev>";

function getAppUrl(): string {
  return import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.fly.dev";
}

function emailTemplate({ heading, body, buttonText, buttonUrl, footnote }: {
  heading: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
  footnote: string;
}) {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin: 0; padding: 0; background-color: #f8faf6; font-family: 'Inter', 'Roboto', 'Helvetica', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8faf6;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width: 480px; width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color: #1b6b4a; padding: 28px 32px; text-align: center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td style="vertical-align: middle; padding-right: 10px;">
                    <img src="${getAppUrl()}/favicon.ico" alt="" width="28" height="28" style="display: block; border: 0;" />
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.01em;">Convocados</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px 16px;">
              <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #1a1d1b; letter-spacing: -0.01em;">${heading}</h1>
              <p style="margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #4a6358;">${body}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td style="border-radius: 24px; background-color: #1b6b4a;">
                    <a href="${buttonUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; letter-spacing: 0.01em;">${buttonText}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footnote -->
          <tr>
            <td style="padding: 24px 32px 36px;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #8a9b92;">${footnote}</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; border-top: 1px solid #e8ece9; text-align: center;">
              <a href="${getAppUrl()}" style="font-size: 12px; color: #8a9b92; text-decoration: none;">convocados.fly.dev</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendVerificationEmail(to: string, url: string) {
  console.log(`[email] Sending verification email to ${to}`);
  const result = await getResend().emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Verify your email — Convocados",
    html: emailTemplate({
      heading: "Verify your email",
      body: "Thanks for signing up for Convocados! Click the button below to verify your email address and get started.",
      buttonText: "Verify email",
      buttonUrl: url,
      footnote: "If you didn't create an account, you can safely ignore this email. This link will expire in 24 hours.",
    }),
  });
  if (result.error) {
    console.error(`[email] Failed to send verification email:`, result.error);
    throw new Error(`Failed to send verification email: ${result.error.message}`);
  }
  console.log(`[email] Verification email sent successfully (id: ${result.data?.id})`);
}

export async function sendChangeEmailVerification(to: string, url: string) {
  console.log(`[email] Sending change-email verification to ${to}`);
  const result = await getResend().emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Confirm your new email — Convocados",
    html: emailTemplate({
      heading: "Confirm your new email",
      body: "You requested to change your email address on Convocados. Click the button below to confirm this new address.",
      buttonText: "Confirm new email",
      buttonUrl: url,
      footnote: "If you didn't request this change, you can safely ignore this email. Your current email will remain unchanged.",
    }),
  });
  if (result.error) {
    console.error(`[email] Failed to send change-email verification:`, result.error);
    throw new Error(`Failed to send change-email verification: ${result.error.message}`);
  }
  console.log(`[email] Change-email verification sent successfully (id: ${result.data?.id})`);
}
