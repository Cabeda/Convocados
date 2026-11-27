/**
 * #1758 — every email that states a game time renders it in the Event's
 * timezone, not the server's (UTC on Fly). These are the failing assertions
 * that reproduced the drift: the reminder body read 18:00 for a 20:00 Madrid
 * game, and the invite body had to equal the app's own `formatDateInTz`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();
vi.mock("resend", () => {
  class MockResend {
    emails = { send: mockSend };
  }
  return { Resend: MockResend };
});

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { sendGameInvite, sendReminder } from "~/lib/email.server";
import { formatDateInTz } from "~/lib/timezones";

const WHEN = "2026-07-10T18:00:00Z";

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
});

describe("email game times honour the Event timezone (#1758)", () => {
  it.each([
    ["Europe/Madrid", "20:00"],
    ["America/New_York", "14:00"],
  ])("renders a reminder for %s at %s", async (timezone, expectedHour) => {
    await sendReminder("player@example.com", {
      eventTitle: "Friday Futsal",
      dateTime: WHEN,
      location: "Sports Center",
      spotsLeft: 3,
      eventUrl: "https://convocados.cabeda.dev/events/abc",
      reminderType: "24h",
      timezone,
    });

    const html = mockSend.mock.calls[0][0].html as string;
    expect(html).toContain(expectedHour);
  });

  it.each(["Europe/Madrid", "America/New_York"])(
    "renders a game invite in %s exactly as formatDateInTz does",
    async (timezone) => {
      await sendGameInvite("player@example.com", {
        eventTitle: "Friday Futsal",
        dateTime: WHEN,
        location: "Sports Center",
        eventUrl: "https://convocados.cabeda.dev/events/abc",
        timezone,
      });

      const expected = formatDateInTz(new Date(WHEN), "en", timezone, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const html = mockSend.mock.calls[0][0].html as string;
      expect(html).toContain(expected);
    },
  );
});
