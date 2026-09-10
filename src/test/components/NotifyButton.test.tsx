/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { NotifyButton } from "~/components/event/NotifyButton";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(handlers: {
  get?: { following: boolean; isPlayer: boolean };
  delete?: () => Response;
  post?: () => Response;
}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "DELETE") return handlers.delete?.() ?? new Response("{}", { status: 200 });
    if (method === "POST") return handlers.post?.() ?? new Response("{}", { status: 200 });
    return new Response(JSON.stringify(handlers.get ?? {}), { status: 200 });
  });
}

describe("NotifyButton follow toggle", () => {
  it("shows the Follow button for a player who is NOT following", async () => {
    vi.stubGlobal("fetch", stubFetch({ get: { following: false, isPlayer: true } }));

    renderWithTheme(<NotifyButton eventId="e1" isAuthenticated />);

    // Regression: a player added to the roster by an organizer is NOT auto-followed.
    // The toggle must still render so they can opt into notifications.
    expect(await screen.findByText(/follow game/i)).toBeInTheDocument();
  });

  it("keeps the toggle hidden for an auto-followed player", async () => {
    vi.stubGlobal("fetch", stubFetch({ get: { following: true, isPlayer: true } }));

    renderWithTheme(<NotifyButton eventId="e1" isAuthenticated />);

    await waitFor(() => expect(screen.queryByText(/follow/i)).not.toBeInTheDocument());
  });

  it("non-player follower can unfollow and the Follow button reappears", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        get: { following: true, isPlayer: false },
        delete: () => new Response(JSON.stringify({ ok: true, following: false }), { status: 200 }),
      }),
    );

    const user = userEvent.setup();
    renderWithTheme(<NotifyButton eventId="e1" isAuthenticated />);

    const followingBtn = await screen.findByText(/following/i);
    await user.click(followingBtn);

    expect(await screen.findByText(/follow game/i)).toBeInTheDocument();
  });
});
