/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { InvitePage } from "~/components/InvitePage";

const GAME = {
  id: "evt-1",
  title: "Ninjas da Areosa",
  location: "Pitch 2",
  dateTime: new Date(Date.now() + 86_400_000).toISOString(),
  maxPlayers: 10,
};

function lookup(overrides: Record<string, unknown> = {}) {
  return {
    valid: true,
    status: "pending",
    token: "tok-1",
    isInvitee: false,
    claimable: true,
    claimPlayerId: "ep-manecas",
    viewerName: null,
    authenticated: false,
    inviteeName: "Manecas",
    invitedByName: "Cabeda",
    gameId: GAME.id,
    game: GAME,
    ...overrides,
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockLookup(data: Record<string, unknown>) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") {
      return Promise.resolve(json(data));
    }
    return Promise.resolve(json({ ok: true, bench: false }));
  });
}

describe("InvitePage — frictionless guest acceptance", () => {
  it("anonymous visitor sees Accept/Decline with no signup wall", async () => {
    mockLookup(lookup());
    renderWithTheme(<InvitePage token="tok-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /accept/i })).toBeTruthy());
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(screen.getByText("Manecas")).toBeTruthy();
    expect(screen.getByText(/no account needed/i)).toBeTruthy();
  });

  it("guest accept posts once, marks the browser, and shows the roster confirmation", async () => {
    mockLookup(lookup());
    const { container } = renderWithTheme(<InvitePage token="tok-1" />);
    const accept = await waitFor(() => screen.getByRole("button", { name: /accept/i }));
    accept.click();

    await waitFor(() => expect(localStorage.getItem("invite-accepted:tok-1")).toBe("Manecas"));
    await waitFor(() => expect(container.textContent).toMatch(/on the list as Manecas/i));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post[1].body)).toEqual({ action: "accept" });
  });

  it("logged-in viewer gets the dual choice: claim vs join-as-guest", async () => {
    mockLookup(lookup({ authenticated: true, viewerName: "Cabeda" }));
    renderWithTheme(<InvitePage token="tok-1" />);

    const asSelf = await waitFor(() => screen.getByTestId("invite-join-self"));
    const asGuest = screen.getByTestId("invite-join-guest");
    expect(asSelf.textContent).toMatch(/Cabeda/);
    expect(asGuest.textContent).toMatch(/Manecas/);

    fireEvent.click(asGuest);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(post[1].body)).toEqual({ action: "accept", asGuest: true });
    });
    // Joining as guest must NOT mark this browser as the claimed player
    expect(localStorage.getItem("invite-accepted:tok-1")).toBeNull();
  });

  it("claim choice posts a plain accept (server claims)", async () => {
    mockLookup(lookup({ authenticated: true, viewerName: "Cabeda" }));
    renderWithTheme(<InvitePage token="tok-1" />);
    fireEvent.click(await waitFor(() => screen.getByTestId("invite-join-self")));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(post[1].body)).toEqual({ action: "accept" });
    });
  });

  it("accepted-but-unclaimed + authenticated shows the one-tap bind CTA", async () => {
    mockLookup(lookup({ status: "accepted", authenticated: true, viewerName: "Cabeda", claimPlayerId: "ep-manecas" }));
    // Second POST (bind) succeeds
    renderWithTheme(<InvitePage token="tok-1" />);
    const bind = await waitFor(() => screen.getByTestId("invite-bind-self"));
    expect(bind.textContent).toMatch(/this is me/i);
    fireEvent.click(bind);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init?.method ?? "") === "POST" && String(init?.body).includes("playerId"));
      expect(post).toBeTruthy();
      expect(JSON.parse(post[1].body)).toEqual({ playerId: "ep-manecas" });
    });
  });

  it("registered invitee keeps the simple Accept/Decline pair", async () => {
    mockLookup(lookup({ claimable: false, claimPlayerId: null, isInvitee: true, authenticated: true, viewerName: "Luís Lopes" }));
    renderWithTheme(<InvitePage token="tok-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^accept$/i })).toBeTruthy());
    expect(screen.queryByTestId("invite-join-guest")).toBeNull();
  });

  it("renders the kick-off in the event timezone, not the viewer's device zone", async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "Europe/Berlin"; // viewer abroad: +1h ahead of the venue
    try {
      // 19:00 UTC is 20:00 in Lisbon (the Event timezone) but 21:00 in Berlin.
      mockLookup(lookup({
        game: { ...GAME, dateTime: "2024-07-15T19:00:00.000Z", timezone: "Europe/Lisbon" },
      }));
      const { container } = renderWithTheme(<InvitePage token="tok-1" />);
      await waitFor(() => expect(screen.getByText("Ninjas da Areosa")).toBeTruthy());
      expect(container.textContent).toContain("20:00");
      expect(container.textContent).not.toContain("21:00");
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  it("anonymous visitor on a claimed invite sees game details, not a bare login wall", async () => {
    mockLookup(lookup({ claimable: false, claimPlayerId: null, isInvitee: false, authenticated: false }));
    renderWithTheme(<InvitePage token="tok-1" />);
    const signIn = await waitFor(() => screen.getByRole("link", { name: /sign in/i }));
    expect(signIn.getAttribute("href")).toBe("/auth/signin?callbackURL=/invite/tok-1");
    expect(screen.getByText("Ninjas da Areosa")).toBeTruthy();
    expect(screen.getByText("Pitch 2")).toBeTruthy();
    expect(screen.getByText("Manecas")).toBeTruthy();
  });
});
