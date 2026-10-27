import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import NotificationsPage from "~/components/NotificationsPage";
import NotificationsBell from "~/components/NotificationsBell";

const JSON_HEADERS = { "Content-Type": "application/json" };

const feed = (overrides: Partial<{ unreadCount: number; rows: unknown[] }> = {}) => ({
  notifications: overrides.rows ?? [
    {
      id: "n1", type: "crew_captain_nominated", title: "Old Bones",
      body: "You were nominated as captain of Old Bones", url: "/events/e1/seasons/s1",
      readAt: null, createdAt: "2026-10-27T10:00:00.000Z", eventId: "e1",
    },
    {
      id: "n2", type: "player_joined", title: "Friday Futsal",
      body: "Ana joined", url: "/events/e1", readAt: "2026-10-26T10:00:00.000Z",
      createdAt: "2026-10-26T10:00:00.000Z", eventId: "e1",
    },
  ],
  unreadCount: overrides.unreadCount ?? 1,
  nextCursor: null,
  hasMore: false,
});

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("NotificationsPage", () => {
  it("lists the feed and deep-links a row to the surface that can act on it", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(feed()), { status: 200, headers: JSON_HEADERS }));

    renderWithTheme(<NotificationsPage />);

    expect(await screen.findByText("You were nominated as captain of Old Bones")).toBeInTheDocument();
    const open = screen.getAllByRole("link", { name: "Open" })[0];
    expect(open).toHaveAttribute("href", "/events/e1/seasons/s1");
  });

  it("marks one notification read", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(feed()), { status: 200, headers: JSON_HEADERS }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS }))
      .mockResolvedValueOnce(new Response(JSON.stringify(feed({ unreadCount: 0 })), { status: 200, headers: JSON_HEADERS }));

    renderWithTheme(<NotificationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark read" }));

    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ ids: ["n1"] });
    });
  });

  it("marks everything read", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(feed()), { status: 200, headers: JSON_HEADERS }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS }))
      .mockResolvedValueOnce(new Response(JSON.stringify(feed({ unreadCount: 0 })), { status: 200, headers: JSON_HEADERS }));

    renderWithTheme(<NotificationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));

    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({});
    });
  });

  it("says there is nothing to do rather than showing a blank page", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(feed({ rows: [], unreadCount: 0 })), { status: 200, headers: JSON_HEADERS }),
    );

    renderWithTheme(<NotificationsPage />);

    expect(await screen.findByText("You are all caught up")).toBeInTheDocument();
  });

  it("announces the change the header bell listens for (#1560 review)", async () => {
    vi.mocked(fetch).mockImplementation((_input, init) => Promise.resolve(
      init?.method === "POST"
        ? new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS })
        : new Response(JSON.stringify(feed()), { status: 200, headers: JSON_HEADERS }),
    ));
    const dispatched: string[] = [];
    const realDispatch = window.dispatchEvent.bind(window);
    vi.spyOn(window, "dispatchEvent").mockImplementation((event: Event) => {
      dispatched.push(event.type);
      return realDispatch(event);
    });

    renderWithTheme(<NotificationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));

    // The bell and the page share no store; the page owes it this event.
    await waitFor(() => expect(dispatched).toContain("notifications:changed"));
  });

  it("asks a signed-out visitor to sign in", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS }));

    renderWithTheme(<NotificationsPage />);

    expect(await screen.findByText("Sign in to see your notifications.")).toBeInTheDocument();
  });
});

describe("NotificationsBell", () => {
  it("shows the unread count and never renders for a signed-out visitor", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(feed({ unreadCount: 3 })), { status: 200, headers: JSON_HEADERS }));

    const { unmount } = renderWithTheme(<NotificationsBell signedIn />);
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/notifications");

    unmount();
    renderWithTheme(<NotificationsBell signedIn={false} />);
    expect(screen.queryByRole("link", { name: "Notifications" })).not.toBeInTheDocument();
  });
});
