/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — component test type suppression for testing-library screen exports
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { InvitationsSection } from "~/components/InvitationsSection";

const invitation = {
  id: "inv1",
  token: "tok1",
  eventId: "e1",
  eventTitle: "Tuesday Football",
  location: "Areosa",
  dateTime: new Date(Date.now() + 86_400_000).toISOString(),
  sport: "football-5v5",
  invitedByName: "Rui",
};

const rosterAdd = {
  id: "ra1",
  eventId: "e2",
  eventTitle: "Sunday Padel",
  location: "Padel Club",
  dateTime: new Date(Date.now() + 86_400_000).toISOString(),
  sport: "padel",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InvitationsSection", () => {
  it("renders nothing when there is nothing to show", () => {
    renderWithTheme(<InvitationsSection invitations={[]} rosterAdds={[]} />);
    expect(screen.queryByTestId("invitations-section")).not.toBeInTheDocument();
  });

  it("lists a pending invitation with accept and decline actions", () => {
    renderWithTheme(<InvitationsSection invitations={[invitation]} rosterAdds={[]} />);
    expect(screen.getByTestId("invitations-section")).toBeInTheDocument();
    expect(screen.getByText(/Tuesday Football/)).toBeInTheDocument();
    expect(screen.getByTestId("invite-accept-inv1")).toBeInTheDocument();
    expect(screen.getByTestId("invite-decline-inv1")).toBeInTheDocument();
  });

  it("accepts an invitation and removes the card", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    renderWithTheme(<InvitationsSection invitations={[invitation]} rosterAdds={[]} />);

    fireEvent.click(screen.getByTestId("invite-accept-inv1"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/invite/tok1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ action: "accept" });
    await waitFor(() => expect(screen.queryByTestId("invite-accept-inv1")).not.toBeInTheDocument());
  });

  it("declines an invitation and removes the card", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    renderWithTheme(<InvitationsSection invitations={[invitation]} rosterAdds={[]} />);

    fireEvent.click(screen.getByTestId("invite-decline-inv1"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "decline" });
    await waitFor(() => expect(screen.queryByTestId("invite-decline-inv1")).not.toBeInTheDocument());
  });

  it("keeps the card and shows an error when the API fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
    renderWithTheme(<InvitationsSection invitations={[invitation]} rosterAdds={[]} />);

    fireEvent.click(screen.getByTestId("invite-accept-inv1"));

    await waitFor(() => expect(screen.getByTestId("invitations-error")).toBeInTheDocument());
    expect(screen.getByTestId("invite-accept-inv1")).toBeInTheDocument();
  });

  it("shows a direct add as an acknowledgement with dismiss, not accept", () => {
    renderWithTheme(<InvitationsSection invitations={[]} rosterAdds={[rosterAdd]} />);
    expect(screen.getByText(/Sunday Padel/)).toBeInTheDocument();
    expect(screen.getByTestId("roster-add-dismiss-ra1")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-accept-ra1")).not.toBeInTheDocument();
  });

  it("hides a dismissed direct add across renders", () => {
    window.localStorage.setItem("roster-add-ack:e2", "1");
    renderWithTheme(<InvitationsSection invitations={[]} rosterAdds={[rosterAdd]} />);
    expect(screen.queryByText(/Sunday Padel/)).not.toBeInTheDocument();
  });
});
