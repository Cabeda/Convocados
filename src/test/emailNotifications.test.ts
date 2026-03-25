import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

import {
  sendGameInvite,
  sendReminder,
  sendWeeklySummary,
  _resetResendClient,
} from "~/lib/email.server";

beforeEach(() => {
  vi.clearAllMocks();
  _resetResendClient();
});

describe("sendGameInvite", () => {
  it("sends invite with game details", async () => {
    mockSend.mockResolvedValue({ data: { id: "inv-1" }, error: null });

    await sendGameInvite("player@example.com", {
      eventTitle: "Friday Futsal",
      dateTime: "2026-03-20T19:00:00Z",
      location: "Sports Center",
      eventUrl: "https://convocados.fly.dev/events/abc",
    });

    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toBe("player@example.com");
    expect(call.subject).toContain("Friday Futsal");
    expect(call.html).toContain("Friday Futsal");
    expect(call.html).toContain("Sports Center");
    expect(call.html).toContain("/events/abc");
  });

  it("throws on Resend error", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "Bad request", name: "validation_error" } });

    await expect(
      sendGameInvite("p@example.com", {
        eventTitle: "Game",
        dateTime: "2026-03-20T19:00:00Z",
        location: "Loc",
        eventUrl: "https://convocados.fly.dev/events/x",
      }),
    ).rejects.toThrow("Failed to send game invite");
  });

  it("includes unsubscribe link", async () => {
    mockSend.mockResolvedValue({ data: { id: "inv-2" }, error: null });

    await sendGameInvite("p@example.com", {
      eventTitle: "Game",
      dateTime: "2026-03-20T19:00:00Z",
      location: "Loc",
      eventUrl: "https://convocados.fly.dev/events/x",
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain("unsubscribe");
  });
});

describe("sendReminder", () => {
  it("sends reminder with time context", async () => {
    mockSend.mockResolvedValue({ data: { id: "rem-1" }, error: null });

    await sendReminder("player@example.com", {
      eventTitle: "Saturday Football",
      dateTime: "2026-03-21T10:00:00Z",
      location: "City Park",
      spotsLeft: 3,
      eventUrl: "https://convocados.fly.dev/events/def",
      reminderType: "24h",
    });

    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toBe("player@example.com");
    expect(call.subject).toContain("Saturday Football");
    expect(call.html).toContain("Saturday Football");
    expect(call.html).toContain("3");
    expect(call.html).toContain("City Park");
  });

  it("throws on Resend error", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "Rate limited", name: "rate_limit_error" } });

    await expect(
      sendReminder("p@example.com", {
        eventTitle: "Game",
        dateTime: "2026-03-21T10:00:00Z",
        location: "Loc",
        spotsLeft: 0,
        eventUrl: "https://convocados.fly.dev/events/x",
        reminderType: "2h",
      }),
    ).rejects.toThrow("Failed to send reminder");
  });
});

describe("sendWeeklySummary", () => {
  it("sends summary with upcoming games and results", async () => {
    mockSend.mockResolvedValue({ data: { id: "sum-1" }, error: null });

    await sendWeeklySummary("player@example.com", {
      userName: "Test User",
      upcoming: [{ title: "Futsal Friday", dateTime: "2026-03-20T19:00:00Z", location: "Gym" }],
      results: [{ title: "Last Game", scoreOne: 3, scoreTwo: 2 }],
      dashboardUrl: "https://convocados.fly.dev/dashboard",
    });

    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toBe("player@example.com");
    expect(call.subject).toContain("Weekly");
    expect(call.html).toContain("Test User");
    expect(call.html).toContain("Futsal Friday");
    expect(call.html).toContain("3 – 2");
  });

  it("handles empty upcoming and results", async () => {
    mockSend.mockResolvedValue({ data: { id: "sum-2" }, error: null });

    await sendWeeklySummary("p@example.com", {
      userName: "Jane",
      upcoming: [],
      results: [],
      dashboardUrl: "https://convocados.fly.dev/dashboard",
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain("No upcoming games");
  });

  it("includes unsubscribe link", async () => {
    mockSend.mockResolvedValue({ data: { id: "sum-3" }, error: null });

    await sendWeeklySummary("p@example.com", {
      userName: "Test",
      upcoming: [],
      results: [],
      dashboardUrl: "https://convocados.fly.dev/dashboard",
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain("unsubscribe");
  });
});
