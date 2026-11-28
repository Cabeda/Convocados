// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act, renderHook } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";
import { useConnection } from "~/components/event/story/useConnection";
import { makeEvent, fakeServer, respond } from "./eventPageHarness";

vi.mock("~/lib/auth.client", () => ({ useSession: () => ({ data: null, isPending: false, refetch: vi.fn() }), signOut: vi.fn() }));
vi.mock("~/components/PushPromptBanner", () => ({ PushPromptBanner: () => null }));

const NOW = new Date("2026-12-01T05:31:00Z");
let down = false;
let status = 0;

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, "", "/events/evt-1");
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  down = false;
  status = 0;
  const server = fakeServer(makeEvent({ dateTime: new Date(NOW.getTime() + 3 * 86_400_000).toISOString() }));
  server.on("GET", "/api/events/evt-1", () => {
    if (down) throw new TypeError("Failed to fetch");
    if (status) return respond(status, { error: "x" });
    return server.state.event;
  });
  server.install();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
const line = () => screen.queryByTestId("offline-notice");

describe("useConnection", () => {
  it("is quiet after one failed read, offline after two in a row, and clears on the next good read", () => {
    const { result } = renderHook(() => useConnection());
    act(() => result.current.report(true));
    act(() => result.current.report(false));
    expect(result.current.offlineSince).toBeNull();
    act(() => result.current.report(false));
    expect(result.current.offlineSince).toBe(NOW.getTime());
    act(() => result.current.report(true));
    expect(result.current.offlineSince).toBeNull();
  });

  it("a good read in between resets the count", () => {
    const { result } = renderHook(() => useConnection());
    act(() => result.current.report(true));
    act(() => result.current.report(false));
    act(() => result.current.report(true));
    act(() => result.current.report(false));
    expect(result.current.offlineSince).toBeNull();
  });
});

describe("EventPage — offline", () => {
  it("says nothing after one failed poll, then says when the page last heard from the server after two", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    await screen.findByRole("heading", { level: 1, name: "Monday Football" });
    down = true;
    await poll();
    expect(line()).toBeNull();
    await poll();
    const notice = await screen.findByTestId("offline-notice");
    expect(notice).toHaveTextContent(/^Offline — showing what we had at /);
    expect(notice).toHaveTextContent(/\d{1,2}:\d{2}/);
    expect(screen.getByTestId("offline-status")).toHaveAttribute("role", "status");
    // The page keeps what it had.
    expect(screen.getByRole("heading", { level: 1, name: "Monday Football" })).toBeInTheDocument();
  });

  it("takes the line away when the server answers again", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    await screen.findByRole("heading", { level: 1, name: "Monday Football" });
    down = true;
    await poll(); await poll();
    expect(await screen.findByTestId("offline-notice")).toBeInTheDocument();
    down = false;
    await poll();
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(line()).toBeNull();
  });

  it("does not call a server that answers with an error 'offline' unless it is down (5xx)", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    await screen.findByRole("heading", { level: 1, name: "Monday Football" });
    status = 404;
    await poll(); await poll();
    expect(line()).toBeNull();
  });
});
