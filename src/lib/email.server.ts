import { createLogger } from "./logger.server";

const log = createLogger("email");

// Lazy-load Resend to avoid pulling it into memory at startup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _resend: any = null;

async function getResend() {
  if (!_resend) {
    const { Resend } = await import("resend");
    const key = import.meta.env.RESEND_API_KEY ?? process.env.RESEND_API_KEY;
    _resend = new Resend(key);
  }
  return _resend as { emails: { send: (opts: any) => Promise<{ data?: { id?: string }; error?: { message: string } | null }> } };
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
  log.info({ to }, "Sending verification email");
  const resend = await getResend();
  const result = await resend.emails.send({
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
    log.error({ err: result.error }, "Failed to send verification email");
    throw new Error(`Failed to send verification email: ${result.error.message}`);
  }
  log.info({ to, id: result.data?.id }, "Verification email sent");
}

// ── Notification emails ───────────────────────────────────────────────────────

export interface GameInviteData {
  eventTitle: string;
  dateTime: string;
  location: string;
  eventUrl: string;
}

export interface PlayerJoinedOwnerData {
  eventTitle: string;
  playerName: string;
  spotsLeft: number;
  eventUrl: string;
}

export async function sendPlayerJoinedOwnerNotification(to: string, data: PlayerJoinedOwnerData) {
  const resend = await getResend();
  const spotsText = data.spotsLeft === 0 ? "Game is now full" : `${data.spotsLeft} spot${data.spotsLeft === 1 ? "" : "s"} left`;
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: `${data.playerName} joined ${data.eventTitle} — Convocados`,
    html: emailTemplate({
      heading: `${data.playerName} joined your game`,
      body: `<strong>${data.playerName}</strong> just joined <strong>${data.eventTitle}</strong>.<br/><br/>👥 ${spotsText}`,
      buttonText: "View game",
      buttonUrl: data.eventUrl,
      footnote: `Don't want these emails? <a href="${getAppUrl()}/dashboard" style="color:#1b6b4a;">unsubscribe</a>`,
    }),
  });
  if (result.error) throw new Error(`Failed to send player joined notification: ${result.error.message}`);
}

export async function sendGameInvite(to: string, data: GameInviteData) {
  const resend = await getResend();
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: `You're invited: ${data.eventTitle} — Convocados`,
    html: emailTemplate({
      heading: `You're invited to ${data.eventTitle}`,
      body: `📍 ${data.location}<br/>🕐 ${new Date(data.dateTime).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
      buttonText: "View game",
      buttonUrl: data.eventUrl,
      footnote: `Don't want these emails? <a href="${getAppUrl()}/dashboard" style="color:#1b6b4a;">unsubscribe</a>`,
    }),
  });
  if (result.error) throw new Error(`Failed to send game invite: ${result.error.message}`);
}

export interface ReminderData {
  eventTitle: string;
  dateTime: string;
  location: string;
  spotsLeft: number;
  eventUrl: string;
  reminderType: "24h" | "2h" | "1h";
}

export async function sendReminder(to: string, data: ReminderData) {
  const spotsText = data.spotsLeft > 0 ? `${data.spotsLeft} spots left` : "Game is full";
  const resend = await getResend();
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: `Reminder: ${data.eventTitle} — Convocados`,
    html: emailTemplate({
      heading: `${data.eventTitle} is coming up`,
      body: `📍 ${data.location}<br/>🕐 ${new Date(data.dateTime).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}<br/>👥 ${spotsText}`,
      buttonText: "View game",
      buttonUrl: data.eventUrl,
      footnote: `Don't want reminders? <a href="${getAppUrl()}/dashboard" style="color:#1b6b4a;">unsubscribe</a>`,
    }),
  });
  if (result.error) throw new Error(`Failed to send reminder: ${result.error.message}`);
}

export interface WeeklySummaryData {
  userName: string;
  upcoming: { title: string; dateTime: string; location: string }[];
  results: { title: string; scoreOne: number; scoreTwo: number }[];
  dashboardUrl: string;
}

export async function sendWeeklySummary(to: string, data: WeeklySummaryData) {
  const upcomingHtml = data.upcoming.length
    ? data.upcoming.map((g) => `• <strong>${g.title}</strong> — ${new Date(g.dateTime).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`).join("<br/>")
    : "No upcoming games this week.";
  const resultsHtml = data.results.length
    ? data.results.map((g) => `• ${g.title}: ${g.scoreOne} – ${g.scoreTwo}`).join("<br/>")
    : "";
  const body = `Hey ${data.userName}!<br/><br/><strong>Upcoming</strong><br/>${upcomingHtml}${resultsHtml ? `<br/><br/><strong>Recent results</strong><br/>${resultsHtml}` : ""}`;
  const resend = await getResend();
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Your Weekly Summary — Convocados",
    html: emailTemplate({
      heading: "Weekly Summary",
      body,
      buttonText: "Go to dashboard",
      buttonUrl: data.dashboardUrl,
      footnote: `Don't want weekly summaries? <a href="${getAppUrl()}/dashboard" style="color:#1b6b4a;">unsubscribe</a>`,
    }),
  });
  if (result.error) throw new Error(`Failed to send weekly summary: ${result.error.message}`);
}

export async function sendMagicLinkEmail(to: string, url: string) {
  log.info({ to }, "Sending magic link email");
  const resend = await getResend();
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Sign in to Convocados",
    html: emailTemplate({
      heading: "Sign in to Convocados",
      body: "Click the button below to sign in. This link will expire in 5 minutes.",
      buttonText: "Sign in",
      buttonUrl: url,
      footnote: "If you didn't request this link, you can safely ignore this email.",
    }),
  });
  if (result.error) {
    log.error({ err: result.error }, "Failed to send magic link email");
    throw new Error(`Failed to send magic link email: ${result.error.message}`);
  }
  log.info({ to, id: result.data?.id }, "Magic link email sent");
}

export async function sendChangeEmailVerification(to: string, url: string) {
  log.info({ to }, "Sending change-email verification");
  const resend = await getResend();
  const result = await resend.emails.send({
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
    log.error({ err: result.error }, "Failed to send change-email verification");
    throw new Error(`Failed to send change-email verification: ${result.error.message}`);
  }
  log.info({ to, id: result.data?.id }, "Change-email verification sent");
}

// ── Payment reminder emails ───────────────────────────────────────────────────

export interface PaymentReminderData {
  eventTitle: string;
  amount: string;
  currency: string;
  eventUrl: string;
}

export async function sendPaymentReminder(to: string, data: PaymentReminderData) {
  const resend = await getResend();
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: `Payment pending: ${data.eventTitle} — Convocados`,
    html: emailTemplate({
      heading: `Payment pending for ${data.eventTitle}`,
      body: `You have an outstanding payment of <strong>${data.amount} ${data.currency}</strong> for this game.<br/><br/>Please settle your payment or contact the event organizer.`,
      buttonText: "View game",
      buttonUrl: data.eventUrl,
      footnote: `Don't want payment reminders? <a href="${getAppUrl()}/dashboard" style="color:#1b6b4a;">unsubscribe</a>`,
    }),
  });
  if (result.error) throw new Error(`Failed to send payment reminder: ${result.error.message}`);
}

// ── Priority enrollment emails ────────────────────────────────────────────────

export interface PriorityEnrollmentData {
  eventTitle: string;
  dateTime: string;
  location: string;
  deadline: string;
  confirmUrl: string;
  declineUrl: string;
}

export async function sendPriorityEnrollment(to: string, data: PriorityEnrollmentData) {
  const deadlineStr = new Date(data.deadline).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const dateStr = new Date(data.dateTime).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const resend = await getResend();
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: `You're in for ${data.eventTitle}! — Convocados`,
    html: emailTemplate({
      heading: `You're in for ${data.eventTitle}!`,
      body: `Your spot is reserved based on your attendance record.<br/><br/>📍 ${data.location}<br/>🕐 ${dateStr}<br/><br/>Confirm by <strong>${deadlineStr}</strong> or your spot opens up for others.<br/><br/><a href="${data.declineUrl}" style="color:#1b6b4a;">Can't make it? Decline here</a>`,
      buttonText: "Confirm my spot",
      buttonUrl: data.confirmUrl,
      footnote: `Don't want auto-enrollment? <a href="${getAppUrl()}/dashboard" style="color:#1b6b4a;">Manage your settings</a>`,
    }),
  });
  if (result.error) throw new Error(`Failed to send priority enrollment email: ${result.error.message}`);
}

export async function sendPriorityDeadlineReminder(to: string, data: PriorityEnrollmentData) {
  const deadlineStr = new Date(data.deadline).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const resend = await getResend();
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: `Confirm your spot for ${data.eventTitle} — deadline soon`,
    html: emailTemplate({
      heading: `Confirm your spot — deadline soon`,
      body: `You haven't confirmed yet for <strong>${data.eventTitle}</strong>.<br/><br/>Your spot will be released on <strong>${deadlineStr}</strong>.<br/><br/><a href="${data.declineUrl}" style="color:#1b6b4a;">Can't make it? Decline here</a>`,
      buttonText: "Confirm my spot",
      buttonUrl: data.confirmUrl,
      footnote: `Don't want auto-enrollment? <a href="${getAppUrl()}/dashboard" style="color:#1b6b4a;">Manage your settings</a>`,
    }),
  });
  if (result.error) throw new Error(`Failed to send priority deadline reminder: ${result.error.message}`);
}

export async function sendPrioritySpotReleased(to: string, data: { eventTitle: string; eventUrl: string }) {
  const resend = await getResend();
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: `Your spot for ${data.eventTitle} was released`,
    html: emailTemplate({
      heading: "Your spot was released",
      body: `The confirmation deadline passed for <strong>${data.eventTitle}</strong>.<br/><br/>You can still join manually if spots are available.`,
      buttonText: "View game",
      buttonUrl: data.eventUrl,
      footnote: `Don't want auto-enrollment? <a href="${getAppUrl()}/dashboard" style="color:#1b6b4a;">Manage your settings</a>`,
    }),
  });
  if (result.error) throw new Error(`Failed to send priority spot released email: ${result.error.message}`);
}
