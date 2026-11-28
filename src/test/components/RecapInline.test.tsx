// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { cssFor } from "../emotionCss";
import { MvpPicker } from "~/components/event/story/MvpPicker";
import { AddScoreSteppers } from "~/components/event/story/AddScoreSteppers";
import { Scoreboard } from "~/components/event/story/Scoreboard";

const headers = new Headers({ "Content-Type": "application/json" });
function stubFetch(get: unknown) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, headers, json: async () => get })));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const people = (n: number) => ({ participants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, voteCount: 0 })) });

describe("MvpPicker", () => {
  const mount = (n: number, over = {}) => {
    stubFetch(people(n));
    const onVote = vi.fn();
    const onCancel = vi.fn();
    renderWithTheme(<MvpPicker eventId="e1" historyId="h1" panelId="panel" selfName="Me" onVote={onVote} onCancel={onCancel} {...over} />);
    return { onVote, onCancel };
  };

  it("lists everybody and has no search box for five candidates or fewer", async () => {
    mount(5);
    expect(await screen.findAllByRole("radio")).toHaveLength(5);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("shows five of nineteen with a search and a Show all, instead of a 1600px card", async () => {
    mount(19);
    expect(await screen.findAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("textbox", { name: "Search by name" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 19" }));
    expect(screen.getAllByRole("radio")).toHaveLength(19);
  });

  it("searches everyone, not only the five shown", async () => {
    mount(19);
    await screen.findAllByRole("radio");
    fireEvent.change(screen.getByRole("textbox", { name: "Search by name" }), { target: { value: "player 17" } });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Player 17" })).toBeInTheDocument();
  });

  it("keeps somebody found by search on the list after the search is cleared", async () => {
    mount(19);
    await screen.findAllByRole("radio");
    const search = screen.getByRole("textbox", { name: "Search by name" });
    fireEvent.change(search, { target: { value: "player 17" } });
    fireEvent.click(screen.getByRole("radio", { name: "Player 17" }));
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("radio", { name: "Player 17" })).toBeChecked();
  });

  it("scrolls inside the card, and keeps Confirm and Not now in sight", async () => {
    mount(19);
    const first = await screen.findAllByRole("radio");
    const scroller = first[0].closest("[class*='MuiBox']")?.parentElement?.closest("[class*='MuiBox']") ?? first[0].closest("div");
    const css = [...document.querySelectorAll("div")].map(cssFor).join("\n");
    expect(css).toMatch(/max-height:\s*17rem/);
    expect(css).toMatch(/overflow-y:\s*auto/);
    expect(cssFor(screen.getByRole("button", { name: "Confirm vote" }).parentElement)).toMatch(/position:\s*sticky/);
    expect(scroller).toBeTruthy();
  });

  it("moves focus to the first player when it opens", async () => {
    mount(3);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Player 0" })).toHaveFocus());
  });

  it("keeps Confirm disabled until someone is picked, then hands the pick to the parent", async () => {
    const { onVote } = mount(3);
    const confirm = await screen.findByRole("button", { name: "Confirm vote" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Player 1" }));
    fireEvent.click(confirm);
    expect(onVote).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", name: "Player 1" }));
  });

  it("has a visible Not now", async () => {
    const { onCancel } = mount(3);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("restores the pick and says what happened after a vote the server refused", async () => {
    mount(3, { initialPick: "p2", startError: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your vote. Try again.");
    expect(screen.getByRole("radio", { name: "Player 2" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Confirm vote" })).toBeEnabled();
  });
});

describe("AddScoreSteppers", () => {
  const mount = (over = {}) => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    renderWithTheme(<AddScoreSteppers panelId="panel" teamOneName="Foxes" teamTwoName="Lions" onSave={onSave} onCancel={onCancel} {...over} />);
    return { onSave, onCancel };
  };

  it("steps each team up and down, never below zero, with sport-neutral names", () => {
    mount();
    const less = screen.getByRole("button", { name: "One less for Foxes" });
    fireEvent.click(less);
    fireEvent.click(screen.getByRole("button", { name: "One more for Foxes" }));
    fireEvent.click(screen.getByRole("button", { name: "One more for Foxes" }));
    fireEvent.click(less);
    expect(screen.getAllByText("1")).toHaveLength(1);
    expect(screen.getAllByText("0")).toHaveLength(1);
  });

  it("puts the keyboard on the first stepper when it opens", () => {
    mount();
    expect(screen.getByRole("button", { name: "One less for Foxes" })).toHaveFocus();
  });

  it("hands the result to the parent on Save", () => {
    const { onSave } = mount();
    fireEvent.click(screen.getByRole("button", { name: "One more for Lions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save score" }));
    expect(onSave).toHaveBeenCalledWith(0, 1);
  });

  it("asks before saving 0–0, and a stepper tap clears the question", () => {
    const { onSave } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Save score" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save 0–0?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "One more for Foxes" }));
    expect(screen.getByRole("button", { name: "Save score" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "One less for Foxes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save score" }));
    fireEvent.click(screen.getByRole("button", { name: "Save 0–0?" }));
    expect(onSave).toHaveBeenCalledWith(0, 0);
  });

  it("has a visible Not now", () => {
    const { onCancel } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("restores the numbers and says what happened after a save the server refused", () => {
    mount({ initial: [3, 2], startError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save the score. Check your connection and try again.");
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("Scoreboard", () => {
  const board = (props = {}) => renderWithTheme(<Scoreboard teamOneName="Foxes" teamTwoName="Lions" scoreOne={5} scoreTwo={3} compact={false} {...props} />);

  it("shows a dash, not zeros, when there is no score", () => {
    renderWithTheme(<Scoreboard teamOneName="A" teamTwoName="B" scoreOne={null} scoreTwo={null} compact={false} />);
    expect(screen.getByTestId("score-one")).toHaveTextContent("–");
  });

  it("puts the winner in the primary colour and the loser quieter", () => {
    board();
    expect(cssFor(screen.getByTestId("score-one"))).toMatch(/color:\s*rgb\(27, 107, 74\)/);
    expect(cssFor(screen.getByTestId("score-two"))).not.toMatch(/color:\s*rgb\(27, 107, 74\)/);
    expect(cssFor(screen.getByText("Foxes"))).toMatch(/font-weight:\s*700/);
    expect(cssFor(screen.getByText("Lions"))).toMatch(/font-weight:\s*400/);
  });

  it("caps the board to a narrow, centred column so the two numbers sit together on a wide screen", () => {
    board();
    const grid = screen.getByTestId("score-one").parentElement.parentElement;
    expect(cssFor(grid)).toMatch(/max-width:\s*28rem/);
    expect(cssFor(grid)).toMatch(/margin-(left|inline-start):\s*auto/);
  });

  it("is one element for assistive tech and sizes the numerals without animating font-size", () => {
    const { rerender } = board();
    const numeral = screen.getByTestId("score-one");
    expect(screen.getAllByTestId("score-one")).toHaveLength(1);
    expect(cssFor(numeral)).not.toMatch(/transition:[^;]*font-size/);
    rerender(<Scoreboard teamOneName="Foxes" teamTwoName="Lions" scoreOne={5} scoreTwo={3} compact />);
    expect(screen.getByTestId("score-one")).toBe(numeral); // the same node, resized
  });

  it("does not animate the first paint, glides with a transform after the viewer changes the size", () => {
    const { rerender } = board();
    expect(cssFor(screen.getByTestId("score-one"))).not.toMatch(/recapNumeral/);
    rerender(<Scoreboard teamOneName="Foxes" teamTwoName="Lions" scoreOne={5} scoreTwo={3} compact />);
    const css = cssFor(screen.getByTestId("score-one"));
    expect(css).toMatch(/animation:[^;]*recapNumeralShrink/);
    const sheets = [...document.querySelectorAll("style")].map((x) => x.textContent).join("\n");
    expect(sheets).toMatch(/@keyframes recapNumeralShrink[^}]*transform:\s*scale\(/);
  });

  it("is instant for people who ask for less motion", () => {
    const { rerender } = board();
    rerender(<Scoreboard teamOneName="Foxes" teamTwoName="Lions" scoreOne={5} scoreTwo={3} compact />);
    expect(cssFor(screen.getByTestId("score-one"))).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation:\s*none/);
  });

  it("puts long team names on their own lines whole, never cut mid-word", () => {
    board({ teamOneName: "Extraordinarily Long Team Name", teamTwoName: "Internationalisation FC" });
    for (const name of ["Extraordinarily Long Team Name", "Internationalisation FC"]) {
      const css = cssFor(screen.getByText(name));
      expect(css).toMatch(/overflow-wrap:\s*break-word/);
      expect(css).not.toMatch(/text-overflow:\s*ellipsis/);
    }
  });
});
