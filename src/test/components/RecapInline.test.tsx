// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { MvpPicker } from "~/components/event/story/MvpPicker";
import { AddScoreSteppers } from "~/components/event/story/AddScoreSteppers";
import { Scoreboard } from "~/components/event/story/Scoreboard";

const headers = new Headers({ "Content-Type": "application/json" });
const calls: Array<{ url: string; method: string; body?: unknown }> = [];
function stubFetch(get: unknown, fail = false) {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method !== "GET" && fail) return Promise.resolve({ ok: false, status: 500, headers, json: async () => ({ error: "boom" }) });
    return Promise.resolve({ ok: true, status: 200, headers, json: async () => (method === "GET" ? get : {}) });
  }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const people = (n: number) => ({ participants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, voteCount: 0 })) });

describe("MvpPicker", () => {
  it("has no search box for a short list", async () => {
    stubFetch(people(5));
    renderWithTheme(<MvpPicker eventId="e1" historyId="h1" selfName="Me" onVoted={vi.fn()} />);
    expect(await screen.findAllByRole("radio")).toHaveLength(5);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("adds a search box above 8 candidates and filters by name", async () => {
    stubFetch(people(12));
    renderWithTheme(<MvpPicker eventId="e1" historyId="h1" selfName="Me" onVoted={vi.fn()} />);
    await screen.findAllByRole("radio");
    fireEvent.change(screen.getByRole("textbox", { name: "Search by name" }), { target: { value: "player 11" } });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });

  it("keeps Confirm disabled until someone is picked, then posts the vote", async () => {
    stubFetch(people(3));
    const onVoted = vi.fn();
    renderWithTheme(<MvpPicker eventId="e1" historyId="h1" selfName="Me" onVoted={onVoted} />);
    const confirm = await screen.findByRole("button", { name: "Confirm vote" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Player 1" }));
    fireEvent.click(confirm);
    await waitFor(() => expect(onVoted).toHaveBeenCalledWith("Player 1"));
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: "/api/events/e1/history/h1/mvp-vote", body: { votedForPlayerId: "p1" } });
  });

  it("says what happened when the vote fails and lets the viewer retry", async () => {
    stubFetch(people(3), true);
    const onVoted = vi.fn();
    renderWithTheme(<MvpPicker eventId="e1" historyId="h1" selfName="Me" onVoted={onVoted} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Player 0" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm vote" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your vote. Try again.");
    expect(onVoted).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm vote" })).toBeEnabled();
  });
});

describe("AddScoreSteppers", () => {
  const mount = (onSaved = vi.fn()) =>
    renderWithTheme(<AddScoreSteppers eventId="e1" historyId="h1" teamOneName="Foxes" teamTwoName="Lions" onSaved={onSaved} />);

  it("steps each team up and down, never below zero, with named buttons", () => {
    mount();
    const less = screen.getByRole("button", { name: "One less goal for Foxes" });
    fireEvent.click(less);
    fireEvent.click(screen.getByRole("button", { name: "One more goal for Foxes" }));
    fireEvent.click(screen.getByRole("button", { name: "One more goal for Foxes" }));
    fireEvent.click(less);
    expect(screen.getAllByText("1")).toHaveLength(1);
    expect(screen.getAllByText("0")).toHaveLength(1);
  });

  it("saves through the history PATCH and reports the result", async () => {
    stubFetch({});
    const onSaved = vi.fn();
    mount(onSaved);
    fireEvent.click(screen.getByRole("button", { name: "One more goal for Lions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save score" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(0, 1));
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "/api/events/e1/history/h1", body: { scoreOne: 0, scoreTwo: 1 } });
  });

  it("explains a failed save and keeps the numbers", async () => {
    stubFetch({}, true);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "One more goal for Foxes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save score" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the score. Check your connection and try again.");
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});

describe("Scoreboard", () => {
  it("shows a dash, not zeros, when there is no score", () => {
    renderWithTheme(<Scoreboard teamOneName="A" teamTwoName="B" scoreOne={null} scoreTwo={null} compact={false} />);
    expect(screen.getByTestId("score-one")).toHaveTextContent("–");
  });

  it("keeps long team names whole", () => {
    renderWithTheme(<Scoreboard teamOneName="Extraordinarily Long Team" teamTwoName="B" scoreOne={1} scoreTwo={0} compact />);
    expect(screen.getByText("Extraordinarily Long Team")).toBeInTheDocument();
  });
});
