import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = import.meta.env.RESEND_API_KEY ?? process.env.RESEND_API_KEY;
    _resend = new Resend(key);
  }
  return _resend;
}

const EMAIL_FROM = import.meta.env.EMAIL_FROM ?? process.env.EMAIL_FROM ?? "Convocados <noreply@convocados.fly.dev>";

export async function sendVerificationEmail(to: string, url: string) {
  await getResend().emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Verify your email — Convocados",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1976d2;">Convocados</h2>
        <p>Click the button below to verify your email address:</p>
        <a href="${url}" style="display: inline-block; background: #1976d2; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          Verify email
        </a>
        <p style="margin-top: 24px; color: #666; font-size: 14px;">
          If you didn't create an account, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}

export async function sendChangeEmailVerification(to: string, url: string) {
  await getResend().emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Confirm your new email — Convocados",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1976d2;">Convocados</h2>
        <p>Click the button below to confirm your new email address:</p>
        <a href="${url}" style="display: inline-block; background: #1976d2; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          Confirm new email
        </a>
        <p style="margin-top: 24px; color: #666; font-size: 14px;">
          If you didn't request this change, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}
