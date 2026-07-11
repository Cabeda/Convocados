import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { SettleHero } from "~/components/settle/SettleHero";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});
afterEach(() => cleanup());

const baseEvent = {
  id: "evt-1",
  title: "Casa",
  timezone: "Europe/Lisbon",
  currency: "EUR",
  monthlyEnabled: false,
  monthlyFeeCents: null,
  monthlyGamesCovered: 0,
  dropInSurchargeCents: 0,
  ownerId: "u-owner",
};

describe("SettleHero", () => {
  it("renders the event title and stats", () => {
    renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 292, members: 2, totalSpentCents: 3705468 }}
        netPositions={[
          { playerName: "Pai", netCents: -257800 },
          { playerName: "José", netCents: 257800 },
        ]}
        onShowCharts={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    expect(screen.getByText("Casa")).toBeInTheDocument();
    expect(screen.getByText("292")).toBeInTheDocument();
    expect(screen.getByText(/37,054\.68/)).toBeInTheDocument();
  });

  it("renders one bubble per non-zero net position (SVG circles)", () => {
    const { container } = renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 292, members: 2, totalSpentCents: 3705468 }}
        netPositions={[
          { playerName: "Pai", netCents: -257800 },
          { playerName: "José", netCents: 257800 },
        ]}
        onShowCharts={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    // Two bubbles expected — one debtor, one creditor.
    const circles = container.querySelectorAll("svg circle");
    expect(circles).toHaveLength(2);
  });

  it("hides the bubble graph when no net positions exist", () => {
    const { container } = renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 5, members: 2, totalSpentCents: 5000 }}
        netPositions={[]}
        onShowCharts={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("svg circle")).toHaveLength(0);
    // The "all clear" message takes its place — use the data-testid to
    // disambiguate from any other copy that contains the words.
    expect(screen.getByTestId("settle-hero-all-clear")).toBeInTheDocument();
  });

  it("calls onMore when the More button is clicked", () => {
    const onMore = vi.fn();
    renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 0, members: 2, totalSpentCents: 0 }}
        netPositions={[{ playerName: "Pai", netCents: -1000 }]}
        onShowCharts={vi.fn()}
        onMore={onMore}
        onChangePaymentMethod={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it("calls onChangePaymentMethod when the Change method button is clicked", () => {
    const onChangePaymentMethod = vi.fn();
    renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 0, members: 2, totalSpentCents: 0 }}
        netPositions={[{ playerName: "Pai", netCents: -1000 }]}
        onShowCharts={vi.fn()}
        onMore={vi.fn()}
        onChangePaymentMethod={onChangePaymentMethod}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /change method/i }));
    expect(onChangePaymentMethod).toHaveBeenCalledTimes(1);
  });

  it("renders the three action buttons in order: Change method, More", () => {
    renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 0, members: 2, totalSpentCents: 0 }}
        netPositions={[{ playerName: "Pai", netCents: -1000 }]}
        onShowCharts={vi.fn()}
        onMore={vi.fn()}
        onChangePaymentMethod={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((b) => b.textContent?.trim() ?? "");
    const changeIdx = labels.findIndex((l) => /change method/i.test(l));
    const moreIdx = labels.findIndex((l) => /^more/i.test(l));
    // "Show charts" button was removed; only "Change method" and "More" remain
    expect(changeIdx).toBeGreaterThanOrEqual(0);
    expect(moreIdx).toBeGreaterThan(changeIdx);
  });

  // ── Responsive layout ───────────────────────────────────────────────────

  it("does not overlap bubbles when there are 5+ players (multi-orbit layout)", () => {
    const { container } = renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 0, members: 6, totalSpentCents: 0 }}
        netPositions={[
          { playerName: "Pai", netCents: -50000 },
          { playerName: "José", netCents: 20000 },
          { playerName: "Ana", netCents: 15000 },
          { playerName: "Bruno", netCents: 10000 },
          { playerName: "Catarina", netCents: 5000 },
        ]}
        onShowCharts={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    const circles = Array.from(container.querySelectorAll("svg circle"));
    expect(circles).toHaveLength(5);
    // For each pair of bubbles, the distance between centers must exceed
    // the sum of their radii (no overlap).
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const a = circles[i] as SVGCircleElement;
        const b = circles[j] as SVGCircleElement;
        const cax = parseFloat(a.getAttribute("cx") ?? "0");
        const cay = parseFloat(a.getAttribute("cy") ?? "0");
        const cbx = parseFloat(b.getAttribute("cx") ?? "0");
        const cby = parseFloat(b.getAttribute("cy") ?? "0");
        const ra = parseFloat(a.getAttribute("r") ?? "0");
        const rb = parseFloat(b.getAttribute("r") ?? "0");
        const dist = Math.hypot(cax - cbx, cay - cby);
        // Allow 2px tolerance for the test assertion.
        expect(dist).toBeGreaterThan(ra + rb - 2);
      }
    }
  });

  it("truncates long player names so they don't overflow the bubble", () => {
    const { container } = renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 0, members: 2, totalSpentCents: 0 }}
        netPositions={[
          { playerName: "Christopher Wellington-Smythe", netCents: -100 },
          { playerName: "X", netCents: 100 },
        ]}
        onShowCharts={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    // The long name should be truncated to ≤ 10 chars + ellipsis in the
    // visible <text> element. The full name lives in the tooltip / aria-label.
    const nameLabels = container.querySelectorAll("svg [data-testid^='bubble-label-']");
    expect(nameLabels.length).toBeGreaterThan(0);
    for (const el of Array.from(nameLabels)) {
      const txt = (el.textContent ?? "").trim();
      expect(txt.length).toBeLessThanOrEqual(11); // "Christopher…" is 12 — bump if needed
    }
    // The full name is still accessible via aria-label.
    const fullNameAccessible = container.querySelector(
      '[aria-label*="Christopher Wellington-Smythe"]',
    );
    expect(fullNameAccessible).toBeTruthy();
  });

  it("hides text inside very small bubbles (no overflow)", () => {
    // One tiny bubble (10 cents) + one large (€2,000). The tiny one should
    // either show no text or only an initial — never a full sentence.
    const { container } = renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 0, members: 2, totalSpentCents: 0 }}
        netPositions={[
          { playerName: "Big", netCents: -200000 },
          { playerName: "Small", netCents: 10 },
        ]}
        onShowCharts={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    const tinyBubble = container.querySelector('[data-testid="bubble-Small"]') as SVGCircleElement | null;
    expect(tinyBubble).toBeTruthy();
    const r = parseFloat(tinyBubble?.getAttribute("r") ?? "0");
    // Tiny bubble should be below the readable-text threshold (≤ 18).
    expect(r).toBeLessThanOrEqual(18);
    // The label inside should either be absent or a single short char.
    const tinyLabel = container.querySelector('[data-testid="bubble-label-Small"]');
    if (tinyLabel) {
      expect((tinyLabel.textContent ?? "").length).toBeLessThanOrEqual(2);
    }
  });

  it("exposes the full amount via aria-label on each bubble group", () => {
    const { container } = renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 0, members: 2, totalSpentCents: 0 }}
        netPositions={[
          { playerName: "Pai", netCents: -257800 },
          { playerName: "José", netCents: 257800 },
        ]}
        onShowCharts={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    // Each bubble group should have an aria-label that includes the player
    // name AND the formatted amount so screen readers (and our tooltip
    // fallback) announce the value.
    const paiBubble = container.querySelector('[aria-label*="Pai"]');
    const joseBubble = container.querySelector('[aria-label*="José"]');
    expect(paiBubble).toBeTruthy();
    expect(joseBubble).toBeTruthy();
    expect(paiBubble?.getAttribute("aria-label")).toMatch(/€2,578/);
    expect(joseBubble?.getAttribute("aria-label")).toMatch(/€2,578/);
  });

  it("renders a color legend explaining the bubble colors", () => {
    renderWithTheme(
      <SettleHero
        event={baseEvent}
        stats={{ transactions: 0, members: 2, totalSpentCents: 0 }}
        netPositions={[
          { playerName: "Pai", netCents: -100 },
          { playerName: "José", netCents: 100 },
        ]}
        onShowCharts={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    expect(screen.getByTestId("settle-hero-legend")).toBeInTheDocument();
  });
});
