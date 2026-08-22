// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { renderWithTheme } from "../render";
import { WebhookSettings } from "~/components/event/WebhookSettings";

expect.extend(jestDomMatchers);

vi.mock("~/lib/useT", () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    if (params) {
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
        key,
      );
    }
    return key;
  },
}));

const h: typeof React.createElement = React.createElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSettings() {
  return renderWithTheme(h(WebhookSettings, { eventId: "evt-1" }));
}

describe("WebhookSettings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/webhooks") && (!init || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            webhooks: [{
              id: "wh-1",
              url: "https://example.com/receive",
              events: ["player_joined", "game_full"],
              createdAt: "2026-01-01T00:00:00.000Z",
            }],
          }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }));
  });

  it("lists registered webhooks", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText("https://example.com/receive")).toBeInTheDocument();
    });
    // chips: player_joined + game_full (telecom checkboxes also render these labels)
    expect(screen.getAllByText("webhookEventType_player_joined").length).toBeGreaterThan(0);
    expect(screen.getAllByText("webhookEventType_game_full").length).toBeGreaterThan(0);
  });

  it("shows empty state when no webhooks", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ webhooks: [] }) }),
    ));
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText("webhookNone")).toBeInTheDocument();
    });
  });

  it("shows an error for an invalid URL", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "not-a-url" } });
    fireEvent.click(screen.getByText("webhookAdd"));
    await waitFor(() => {
      expect(screen.getByText("webhookInvalidUrl")).toBeInTheDocument();
    });
  });

  it("registers a webhook via POST", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "wh-2" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ webhooks: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSettings();
    await waitFor(() => expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText("webhookNone")).toBeInTheDocument());

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "https://example.com/incoming" } });
    fireEvent.click(screen.getByText("webhookAdd"));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call as [string, RequestInit])[1].body))).toMatchObject({
        url: "https://example.com/incoming",
        events: ["player_joined", "player_left", "game_full", "game_reset", "player_invited"],
      });
    });
  });

  it("sends a test payload and shows status", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/test") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            delivery: { id: "d-1", eventType: "test", status: "success", attempts: 1, error: null, deliveredAt: "2026-01-01T00:00:01.000Z", createdAt: "2026-01-01T00:00:00.000Z" },
          }),
        });
      }
      if (!init || init.method === "GET") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            webhooks: [{ id: "wh-1", url: "https://example.com/receive", events: [], createdAt: "2026-01-01T00:00:00.000Z" }],
          }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSettings();
    await waitFor(() => expect(screen.getByText("webhookAllEvents")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "webhookTest" }));

    await waitFor(() => {
      expect(screen.getByText(/webhookTestOk/)).toBeInTheDocument();
    });
  });

  it("deletes a webhook", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          webhooks: [{ id: "wh-1", url: "https://example.com/receive", events: [], createdAt: "2026-01-01T00:00:00.000Z" }],
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSettings();
    await waitFor(() => expect(screen.getByText("https://example.com/receive")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "webhookDelete" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(true);
    });
  });

  it("edits webhook events via PATCH", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: "wh-1",
            url: "https://example.com/receive",
            events: ["player_joined"],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          webhooks: [{
            id: "wh-1",
            url: "https://example.com/receive",
            events: ["player_joined", "game_full"],
            createdAt: "2026-01-01T00:00:00.000Z",
          }],
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSettings();
    await waitFor(() => expect(screen.getByText("https://example.com/receive")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "webhookEdit" }));

    const dialog = await screen.findByRole("dialog");
    const gameFullCheckbox = within(dialog).getByRole("checkbox", { name: "webhookEventType_game_full" });
    fireEvent.click(gameFullCheckbox);
    fireEvent.click(within(dialog).getByRole("button", { name: "webhookSave" }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String((patchCall as [string, RequestInit])[1].body))).toEqual({
        events: ["player_joined"],
      });
    });
  });

  it("cancels edit without sending PATCH", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            webhooks: [{
              id: "wh-1",
              url: "https://example.com/receive",
              events: ["player_joined", "game_full"],
              createdAt: "2026-01-01T00:00:00.000Z",
            }],
          }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSettings();
    await waitFor(() => expect(screen.getByText("https://example.com/receive")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "webhookEdit" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "cancel" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false);
    });
  });
});
