// eslint-disable @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InviteShareDialog } from "~/components/event/InviteShareDialog";

afterEach(() => cleanup());

describe("InviteShareDialog — ADR 0025 no-channels fallback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom has no clipboard; stub it like a real browser
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("shows the invitee name, the explanation and the invite link", () => {
    render(<InviteShareDialog open name="Alice" url="https://convocados.cabeda.dev/invite/abc123" onClose={() => {}} />);

    expect(screen.getByText("Invite sent to Alice")).toBeInTheDocument();
    expect(screen.getByText(/Share this link with Alice/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://convocados.cabeda.dev/invite/abc123")).toBeInTheDocument();
  });

  it("copies the link to the clipboard and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<InviteShareDialog open name="Alice" url="https://convocados.cabeda.dev/invite/abc123" onClose={() => {}} />);

    fireEvent.click(screen.getByText("Copy link"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://convocados.cabeda.dev/invite/abc123");
      expect(screen.getByText("Invite link copied")).toBeInTheDocument();
    });
  });

  it("renders nothing when closed", () => {
    render(<InviteShareDialog open={false} name="Alice" url="https://x.dev/invite/abc" onClose={() => {}} />);
    expect(screen.queryByText(/No notifications enabled/)).not.toBeInTheDocument();
  });
});