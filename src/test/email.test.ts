import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Resend before importing the module under test
const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

import { sendVerificationEmail, sendChangeEmailVerification, _resetResendClient } from "~/lib/email.server";

beforeEach(() => {
  vi.clearAllMocks();
  _resetResendClient();
});

describe("sendVerificationEmail", () => {
  it("sends email with correct params", async () => {
    mockSend.mockResolvedValue({ data: { id: "email-123" }, error: null });

    await sendVerificationEmail("user@example.com", "https://example.com/verify?token=abc");

    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toBe("user@example.com");
    expect(call.subject).toBe("Verify your email — Convocados");
    expect(call.html).toContain("https://example.com/verify?token=abc");
    expect(call.html).toContain("Verify email");
    expect(call.from).toContain("Convocados");
  });

  it("throws when Resend returns an error", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "Invalid API key", name: "validation_error" } });

    await expect(sendVerificationEmail("user@example.com", "https://example.com/verify"))
      .rejects.toThrow("Failed to send verification email: Invalid API key");
  });

  it("includes the verification URL in the email body", async () => {
    mockSend.mockResolvedValue({ data: { id: "email-456" }, error: null });
    const url = "https://convocados.fly.dev/api/auth/verify-email?token=xyz&callbackURL=/";

    await sendVerificationEmail("test@test.com", url);

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain(`href="${url}"`);
  });

  it("includes safety disclaimer in email", async () => {
    mockSend.mockResolvedValue({ data: { id: "email-789" }, error: null });

    await sendVerificationEmail("user@example.com", "https://example.com/verify");

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain("safely ignore this email");
  });
});

describe("sendChangeEmailVerification", () => {
  it("sends email with correct params", async () => {
    mockSend.mockResolvedValue({ data: { id: "email-change-1" }, error: null });

    await sendChangeEmailVerification("new@example.com", "https://example.com/confirm?token=def");

    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toBe("new@example.com");
    expect(call.subject).toBe("Confirm your new email — Convocados");
    expect(call.html).toContain("https://example.com/confirm?token=def");
    expect(call.html).toContain("Confirm new email");
  });

  it("throws when Resend returns an error", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "Rate limited", name: "rate_limit_error" } });

    await expect(sendChangeEmailVerification("new@example.com", "https://example.com/confirm"))
      .rejects.toThrow("Failed to send change-email verification: Rate limited");
  });

  it("includes safety disclaimer in email", async () => {
    mockSend.mockResolvedValue({ data: { id: "email-change-2" }, error: null });

    await sendChangeEmailVerification("new@example.com", "https://example.com/confirm");

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain("safely ignore this email");
  });
});
